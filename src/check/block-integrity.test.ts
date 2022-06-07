/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashValueType, ResultCode, ResultPredicate } from "../common";
import { correctBlocks, MockBlock, MockSource } from "../mock/mock-block";
import { BlockProvider } from "../provider";
import { ResultSet } from "../result-set";
import GenericBlockIntegrityChecker from "./block-integrity";

const incorrectBlocks = [
    // Block 0 : Block.Hash != Hash(Block.Hash)
    new MockBlock(0, Buffer.from("ABCD"), Buffer.from(""), Buffer.from("ABCDE"), Buffer.from("PABCD"), []),
    // Block 1 : Block.PrevHash != PrevHash(Block(0).Hash)
    new MockBlock(1, Buffer.from("XYZW"), Buffer.from("ABCD"), Buffer.from("XYZW"), Buffer.from("PABCD"), [])
];

test("Correct chain", async () => {
    const targetBlocks = correctBlocks;
    const provider = new BlockProvider(new MockSource("mock-source", "mock-org", targetBlocks));
    const resultSet = new ResultSet();
    const checker = new GenericBlockIntegrityChecker(provider, resultSet);

    for (let i = 0; i < correctBlocks.length; i++) {
        await checker.performCheck(i);
    }

    const blockResults = resultSet.getBlockResults();
    for (let i = 0; i < targetBlocks.length; i++) {
        const blockResult = blockResults[i];

        expect(blockResult).toBeDefined();
        expect(blockResult.number).toBe(i);

        for (const checkResult of blockResult.results) {
            if (checkResult.checkerID === "GenericBlockIntegrityChecker.checkHash") {
                expect(checkResult.result).toBe(ResultCode.OK);
                if (checkResult.result === ResultCode.OK) {
                    expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                    expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".Hash");
                    expect(checkResult.operands[0].value).toEqual(targetBlocks[i].getHashValue());
                    expect(checkResult.operands[1].value)
                        .toEqual(targetBlocks[i].calcHashValue(HashValueType.HASH_FOR_SELF));
                }
            } else if (checkResult.checkerID === "GenericBlockIntegrityChecker.checkPreviousHash") {
                expect(checkResult.result).toBe(ResultCode.OK);
                if (checkResult.result === ResultCode.OK) {
                    if (i === 0) {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQ);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".Number");
                        expect(checkResult.operands[0].value).toBe(i);
                        expect(checkResult.operands[1].value).toBe(0);
                    } else {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".PreviousHash");
                        expect(checkResult.operands[0].value).toEqual(targetBlocks[i].getPrevHashValue());
                        expect(checkResult.operands[1].value)
                            .toEqual(targetBlocks[i].calcHashValue(HashValueType.HASH_FOR_PREV));
                    }
                }
            }
        }
    }

    return;
});

test("Incorrect chain", async () => {
    const targetBlocks = incorrectBlocks;
    const provider = new BlockProvider(new MockSource("mock-source", "mock-org", targetBlocks));
    const resultSet = new ResultSet();
    const checker = new GenericBlockIntegrityChecker(provider, resultSet);

    for (let i = 0; i < correctBlocks.length; i++) {
        await checker.performCheck(i);
    }

    const blockResults = resultSet.getBlockResults();
    for (let i = 0; i < targetBlocks.length; i++) {
        const blockResult = blockResults[i];

        expect(blockResult).toBeDefined();
        expect(blockResult.number).toBe(i);

        for (const checkResult of blockResult.results) {
            if (checkResult.checkerID === "GenericBlockIntegrityChecker.checkHash") {
                if (i === 0) {
                    expect(checkResult.result).toBe(ResultCode.ERROR);
                    if (checkResult.result === ResultCode.ERROR) {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".Hash");
                        expect(checkResult.operands[0].value).toEqual(targetBlocks[i].getHashValue());
                        expect(checkResult.operands[1].value)
                            .toEqual(targetBlocks[i].calcHashValue(HashValueType.HASH_FOR_SELF));
                    }
                } else {
                    expect(checkResult.result).toBe(ResultCode.OK);
                    if (checkResult.result === ResultCode.OK) {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".Hash");
                        expect(checkResult.operands[0].value).toEqual(targetBlocks[i].getHashValue());
                        expect(checkResult.operands[1].value)
                            .toEqual(targetBlocks[i].calcHashValue(HashValueType.HASH_FOR_SELF));
                    }
                }
            } else if (checkResult.checkerID === "GenericBlockIntegrityChecker.checkPreviousHash") {
                if (i === 0) {
                    expect(checkResult.result).toBe(ResultCode.OK);
                    if (checkResult.result === ResultCode.OK) {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQ);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".Number");
                        expect(checkResult.operands[0].value).toBe(i);
                        expect(checkResult.operands[1].value).toBe(0);
                    }
                } else {
                    expect(checkResult.result).toBe(ResultCode.ERROR);
                    if (checkResult.result === ResultCode.ERROR) {
                        expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                        expect(checkResult.operands[0].name).toBe(targetBlocks[i] + ".PreviousHash");
                        expect(checkResult.operands[0].value).toEqual(targetBlocks[i].getPrevHashValue());
                        expect(checkResult.operands[1].value)
                            .toEqual(targetBlocks[i].calcHashValue(HashValueType.HASH_FOR_PREV));
                    }
                }
            }
        }
    }

    return;
});
