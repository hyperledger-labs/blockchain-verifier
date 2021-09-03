/*
 * Copyright 2021 Hitachi, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BCVerifierError, Block, KeyValueBlock, KeyValueState, KeyValueTransaction, Transaction } from "./common";
import { KeyValueManagerInitialState } from "./kvmanager";

export interface BCVSnapshotData {
    networkPlugin: string;
    snapshotDataType: string;

    lastBlock: number;
    lastTransaction: string;

    timestamp: number;

    blockInformation?: any;
    transactionInformation?: any;
    stateInformation?: any;
    additionalInformation?: any;
}

export interface BCVSnapshotContext {
    block: Block;
    transaction: Transaction;
    timestamp: number | null;
}
export interface BCVKVSnapshotContext extends BCVSnapshotContext {
    block: KeyValueBlock;
    transaction: KeyValueTransaction;
    state: KeyValueState;
}

export abstract class BCVSnapshot {
    protected data: BCVSnapshotData;

    public constructor(pluginName: string, dataType: string, snapshot: BCVSnapshotData | null, context?: BCVSnapshotContext) {
        if (snapshot != null) {
            if (dataType !== snapshot.snapshotDataType) {
                throw new BCVerifierError("Datatype does not match");
            }
            this.data = snapshot;
        } else if (context != null) {
            this.data = {
                networkPlugin: pluginName,
                snapshotDataType: dataType,

                lastBlock: context.block.getBlockNumber(),
                lastTransaction: context.transaction.getTransactionID(),

                timestamp: context.timestamp == null ? Date.now() : context.timestamp,
            };
        } else {
            throw new BCVerifierError("Neither context nor snapshot is supplied");
        }
    }

    public abstract getInitialKVState(): Promise<KeyValueManagerInitialState | undefined>;

    public abstract getSnapshot(): Promise<BCVSnapshotData>;

    public getSnapshotJSON(): Promise<string> {
        return this.getSnapshot().then((snapshot) => JSON.stringify(snapshot));
    }
}
