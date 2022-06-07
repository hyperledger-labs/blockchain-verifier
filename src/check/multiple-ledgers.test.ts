/*
 * Copyright 2021 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import GenericMultipleLedgerBlockPlugin from "./multiple-ledgers";

import { correctBlocks, MockBlock, MockSource } from "../mock/mock-block";
import { BlockProvider } from "../provider";
import { ResultSet } from "../result-set";
import { ResultCode, ResultPredicate } from "../common";

test("correct ledgers", async () => {
    const preferredProvider = new BlockProvider(new MockSource("mock1", "mock-org1", correctBlocks));
    const otherProviders = [new BlockProvider(new MockSource("mock2", "mock-org2", correctBlocks))];

    const resultSet = new ResultSet();
    const checker = new GenericMultipleLedgerBlockPlugin(preferredProvider, otherProviders, resultSet);

    for (let i = 0; i < correctBlocks.length; i++) {
        await checker.performCheck(i);
    }

    const blockResults = resultSet.getBlockResults();
    for (let i = 0; i < correctBlocks.length; i++) {
        const blockResult = blockResults[i];

        expect(blockResult).toBeDefined();
        expect(blockResult.number).toBe(i);

        expect(blockResult.results).toHaveLength(1);
        expect(blockResult.results[0].checkerID).toBe("GenericMultipleLedgerBlockPlugin.blockHashComparisonWithOtherSource");

        const checkResult = blockResult.results[0];
        expect(checkResult.result).toBe(ResultCode.OK);
        if (checkResult.result === ResultCode.OK) {
            expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
            expect(checkResult.operands[0].name).toBe("mock1." + correctBlocks[i] + ".Hash");
            expect(checkResult.operands[0].value).toEqual(correctBlocks[i].getHashValue());
            expect(checkResult.operands[1].name).toBe("mock2." + correctBlocks[i] + ".Hash");
            expect(checkResult.operands[1].value).toEqual(correctBlocks[i].getHashValue());
        }
    }
});

export const incorrectBlocks = [
    new MockBlock(0, Buffer.from("NNNN"), Buffer.from(""), Buffer.from("NNNN"), Buffer.from("PABCD"),
                  [ { id: "Tx1", type: 1 }, { id: "Tx2", type: 2 }]),
    new MockBlock(1, Buffer.from("EFGH"), Buffer.from("PABCD"), Buffer.from("EFGH"), Buffer.from("PABCD"),
                  [ { id: "Tx3", type: 3 }, { id: "Tx4", type: 1 }])
];

test("incorrect ledgers", async () => {
    const preferredProvider = new BlockProvider(new MockSource("mock1", "mock-org1", correctBlocks));
    const otherProviders = [new BlockProvider(new MockSource("mock2", "mock-org2", incorrectBlocks))];

    const resultSet = new ResultSet();
    const checker = new GenericMultipleLedgerBlockPlugin(preferredProvider, otherProviders, resultSet);

    for (let i = 0; i < correctBlocks.length; i++) {
        await checker.performCheck(i);
    }

    const blockResults = resultSet.getBlockResults();
    for (let i = 0; i < correctBlocks.length; i++) {
        const blockResult = blockResults[i];

        expect(blockResult).toBeDefined();
        expect(blockResult.number).toBe(i);

        expect(blockResult.results).toHaveLength(1);
        expect(blockResult.results[0].checkerID).toBe("GenericMultipleLedgerBlockPlugin.blockHashComparisonWithOtherSource");

        const checkResult = blockResult.results[0];
        expect(checkResult.result).toBe(ResultCode.ERROR);
        if (checkResult.result === ResultCode.ERROR) {
            expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
            expect(checkResult.operands[0].name).toBe("mock1." + correctBlocks[i] + ".Hash");
            expect(checkResult.operands[0].value).toEqual(correctBlocks[i].getHashValue());
            expect(checkResult.operands[1].name).toBe("mock2." + correctBlocks[i] + ".Hash");
            expect(checkResult.operands[1].value).toEqual(incorrectBlocks[i].getHashValue());
        }
    }
});

test("correct but imbalance ledgers", async () => {
    const preferredProvider = new BlockProvider(new MockSource("mock1", "mock-org1", correctBlocks));
    const otherProviders = [new BlockProvider(new MockSource("mock2", "mock-org2", correctBlocks.slice(0, 1)))];

    const resultSet = new ResultSet();
    const checker = new GenericMultipleLedgerBlockPlugin(preferredProvider, otherProviders, resultSet);

    for (let i = 0; i < correctBlocks.length; i++) {
        await checker.performCheck(i);
    }

    const blockResults = resultSet.getBlockResults();
    for (let i = 0; i < correctBlocks.length; i++) {
        const blockResult = blockResults[i];

        if (i === 0) {
            expect(blockResult).toBeDefined();
            expect(blockResult.number).toBe(i);
            expect(blockResult.results).toHaveLength(1);
            expect(blockResult.results[0].checkerID).toBe("GenericMultipleLedgerBlockPlugin.blockHashComparisonWithOtherSource");

            const checkResult = blockResult.results[0];
            expect(checkResult.result).toBe(ResultCode.OK);
            if (checkResult.result === ResultCode.OK) {
                expect(checkResult.predicate).toBe(ResultPredicate.EQBIN);
                expect(checkResult.operands[0].name).toBe("mock1." + correctBlocks[i] + ".Hash");
                expect(checkResult.operands[0].value).toEqual(correctBlocks[i].getHashValue());
                expect(checkResult.operands[1].name).toBe("mock2." + correctBlocks[i] + ".Hash");
                expect(checkResult.operands[1].value).toEqual(correctBlocks[i].getHashValue());
            }
        } else {
            expect(blockResult).toBeUndefined();
        }
    }
});
