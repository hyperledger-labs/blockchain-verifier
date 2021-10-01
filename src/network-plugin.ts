/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Block, Transaction } from "./common";
import { BlockProvider } from "./provider";
import { BCVSnapshot, BCVSnapshotData } from "./snapshot";

export interface BlockSource {
    getSourceID(): string;
    getSourceOrganizationID(): string;

    getBlock(blockNumber: number): Promise<Block>;
    getBlockRange(blockStart: number, blockEnd: number): Promise<Block[]>;
    getBlockHash(blockNumber: number): Promise<Buffer>;
    getBlockHeight(): Promise<number>;

    findBlockByTransaction(transactionID: string): Promise<Block>;
}

export enum DataModelType {
    Other = 0,
    KeyValue = 1,
    UTXO = 2
}

export interface NetworkPlugin {
    getBlockSources(): Promise<BlockSource[]>;
    getPreferredBlockSource(): Promise<BlockSource>;
    getDataModelType(): DataModelType;
    createSnapshot(provider: BlockProvider, transaction: Transaction): Promise<BCVSnapshotData>;
    loadFromSnapshot(data: BCVSnapshotData): BCVSnapshot;
}
