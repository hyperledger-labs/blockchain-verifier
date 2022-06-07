/*
 * Generic block integrity check
 *
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BlockCheckPlugin } from ".";
import { Block, HashValueType, ResultPredicate } from "../common";
import { BlockProvider } from "../provider";
import { BlockResultPusher, ResultSet } from "../result-set";

export default class GenericBlockIntegrityChecker implements BlockCheckPlugin {
    public checkerName = "GenericBlockIntegrityChecker";

    private provider: BlockProvider;
    private results: BlockResultPusher;

    constructor(provider: BlockProvider, resultSet: ResultSet) {
        this.provider = provider;
        this.results = new BlockResultPusher(this.checkerName, resultSet);
    }

    public async performCheck(blockNumber: number): Promise<void> {
        const block = await this.provider.getBlock(blockNumber);
        let prevBlock: Block | null = null;

        this.results.setBlock(block);
        if (blockNumber > 0) {
            prevBlock = await this.provider.getBlock(blockNumber - 1);
        }

        this.checkPreviousHash(block, prevBlock);
        this.checkHash(block);
    }

    private checkPreviousHash(block: Block, prevBlock: Block | null): void {
        if (prevBlock == null) {
            this.results.addResult("checkPreviousHash", ResultPredicate.EQ,
                                   { name: block + ".Number", value: block.getBlockNumber() },
                                   { name: "0", value: 0 });
            return;
        }
        const prevHash = block.getPrevHashValue();
        const prevCalcHash = prevBlock.calcHashValue(HashValueType.HASH_FOR_PREV);

        this.results.addResult("checkPreviousHash", ResultPredicate.EQBIN,
                               { name : block + ".PreviousHash", value: prevHash },
                               { name : "HashForPrev(" + prevBlock + ")", value: prevCalcHash });
    }

    private checkHash(block: Block): void {
        const currentHash = block.getHashValue();
        const currentCalcHash = block.calcHashValue(HashValueType.HASH_FOR_SELF);

        this.results.addResult("checkHash", ResultPredicate.EQBIN,
                               { name : block.toString() + ".Hash", value: currentHash },
                               { name : "HashForSelf(" + block + ")", value: currentCalcHash });
    }
}
