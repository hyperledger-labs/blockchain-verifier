/*
 * Copyright 2021 Hitachi, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BCVerifierError, Block, KeyValueState, Transaction } from "./common";
import { KeyValueManagerInitialState } from "./kvmanager";

export interface BCVCheckpointData {
    networkPlugin: string;
    checkpointDataType: string;

    lastBlock: number;
    lastTransaction: string;

    timestamp: number;

    blockInformation?: any;
    transactionInformation?: any;
    stateInformation?: any;
    additionalInformation?: any;
}

export interface BCVCheckpointContext {
    block: Block;
    transaction: Transaction;
    timestamp: number | null;
    state?: KeyValueState;
}

export abstract class BCVCheckpoint {
    protected data: BCVCheckpointData;

    public constructor(pluginName: string, dataType: string, Checkpoint: BCVCheckpointData | null, context?: BCVCheckpointContext) {
        if (Checkpoint != null) {
            if (dataType !== Checkpoint.checkpointDataType) {
                throw new BCVerifierError("Datatype does not match");
            }
            this.data = Checkpoint;
        } else if (context != null) {
            this.data = {
                networkPlugin: pluginName,
                checkpointDataType: dataType,

                lastBlock: context.block.getBlockNumber(),
                lastTransaction: context.transaction.getTransactionID(),

                timestamp: context.timestamp == null ? Date.now() : context.timestamp,
            };
        } else {
            throw new BCVerifierError("Neither context nor Checkpoint is supplied");
        }
    }

    public getLastBlock() {
        return this.data.lastBlock;
    }

    public abstract getInitialKVState(): Promise<KeyValueManagerInitialState | undefined>;

    public abstract getCheckpoint(): Promise<BCVCheckpointData>;

    public getCheckpointJSON(): Promise<string> {
        return this.getCheckpoint().then((Checkpoint) => JSON.stringify(Checkpoint));
    }
}
