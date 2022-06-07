/*
 * Generic block checker plugin comparing with multiple ledgers
 *
 * Copyright 2021 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BlockCheckPlugin, MultipleLedgerCheckPlugin } from ".";
import { ResultPredicate } from "../common";
import { BlockProvider } from "../provider";
import { BlockResultPusher, ResultSet } from "../result-set";

export default class GenericMultipleLedgerBlockPlugin extends MultipleLedgerCheckPlugin implements BlockCheckPlugin {
    public readonly checkerName = "GenericMultipleLedgerBlockPlugin";

    public results: BlockResultPusher;

    public constructor(preferredBlockProvider: BlockProvider, otherProviders: BlockProvider[], resultSet: ResultSet) {
        super(preferredBlockProvider, otherProviders, resultSet);

        this.results = new BlockResultPusher(this.checkerName, resultSet);
    }

    public async performCheck(blockNumber: number): Promise<void> {
        const baseBlock = await this.preferredBlockProvider.getBlock(blockNumber);
        const baseSourceId = this.preferredBlockProvider.getSourceID();

        this.results.setBlock(baseBlock);

        for (const provider of this.otherProviders) {
            try {
                const block = await provider.getBlock(blockNumber);

                this.results.addResult("blockHashComparisonWithOtherSource", ResultPredicate.EQBIN,
                                       {
                                           name: `${baseSourceId}.${baseBlock}.Hash`,
                                           value: baseBlock.getHashValue()
                                       }, {
                                           name: `${provider.getSourceID()}.${block}.Hash`,
                                           value: block.getHashValue()
                                       });
            } catch (e) {
                // Ignore error because some source might not have some block
            }
        }
    }
}
