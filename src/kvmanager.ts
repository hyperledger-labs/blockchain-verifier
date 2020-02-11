/*
 * Copyright 2019 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import * as util from "util";
import { BCVerifierError, BCVerifierNotFound, KeyValue, KeyValueBlock, KeyValuePair, KeyValuePairWrite, KeyValueState,
         Transaction } from "./common";

export class KeyValueManagerBlockNotSufficientError extends Error {
    // Need to feed more blocks
}
export interface KeyValueManager {
    getNextDesiredBlockNumber(): number;
    feedBlock(block: KeyValueBlock): boolean;
    getState(block: KeyValueBlock): SimpleKeyValueState;
}
export interface KeyValueManagerInitialState {
    lastBlockNumber: number;
    keyValueState: KeyValuePairWrite[];
}

// Implementation of Simple Key-Value Manager
type KeyValuePairWithTx = KeyValuePair & {
    transaction: Transaction | null;
};
type KeyValuePairWriteWithTx = KeyValuePairWrite & {
    transaction: Transaction | null;
};

type SimpleKeyValueHistory = {
    [key: string]: KeyValuePairWithTx[]
};

class SimpleKeyValue implements KeyValue {
    protected keyValueManager: SimpleKeyValueManager;
    protected idxInHistory: number;
    protected pair: KeyValuePairWriteWithTx;

    public constructor(mgr: SimpleKeyValueManager, pair: KeyValuePairWriteWithTx) {
        this.pair = pair;
        this.keyValueManager = mgr;

        this.idxInHistory = this.keyValueManager.getVersionsForKey(this.pair.key).findIndex(
            (v) => v.version.compare(this.pair.version) === 0
        );
    }
    public getKey(): Buffer {
        return this.pair.key;
    }
    public getValue(): Buffer {
        return this.pair.value;
    }
    public getVersion(): Buffer {
        return this.pair.version;
    }

    /* The following methods are defined as async just to return a promise. In this implementation, they can be sync */
    public async getTransaction(): Promise<Transaction | null> {
        return this.pair.transaction;
    }
    public async getHistory(): Promise<SimpleKeyValue[]> {
        let ret: SimpleKeyValue[] = [];

        this.keyValueManager.getVersionsForKey(this.pair.key)
            .slice(0, this.idxInHistory + 1).forEach((pair) => {
                if (pair.isDelete) {
                    ret = [];
                } else {
                    ret.push(new SimpleKeyValue(this.keyValueManager, pair));
                }
        });

        return ret;
    }
}

export class SimpleKeyValueState implements KeyValueState {
    protected values: { [key: string]: KeyValuePairWriteWithTx };
    protected keyValueManager: SimpleKeyValueManager;

    public constructor(mgr: SimpleKeyValueManager, prev?: SimpleKeyValueState) {
        if (prev == null) {
            this.values = {};
        } else {
            this.values = Object.assign({}, prev.values);
        }
        this.keyValueManager = mgr;
    }
    public addKeyValuePair(pair: KeyValuePairWithTx) {
        const keyName = pair.key.toString("hex");
        if (pair.isDelete) {
            delete this.values[keyName];
        } else {
            this.values[keyName] = pair;
        }
    }

    public getValue(key: Buffer): KeyValue {
        const keyName = key.toString("hex");
        if (this.values[keyName] != null) {
            return new SimpleKeyValue(this.keyValueManager, this.values[keyName]);
        } else {
            throw new BCVerifierNotFound();
        }
    }
    public getKeys(): KeyValue[] {
        const keyValues = [];
        for (const key in this.values) {
            keyValues.push(new SimpleKeyValue(this.keyValueManager, this.values[key]));
        }
        return keyValues;
    }
}

export class SimpleKeyValueManager implements KeyValueManager {
    protected startBlock: number;
    protected nextBlock: number;

    // Latest Key-Value and Versions
    protected keyVersions: SimpleKeyValueHistory;
    protected snapshot: { [blockNumber: number]: SimpleKeyValueState };

    public constructor(initialState?: KeyValueManagerInitialState) {
        if (initialState != null) {
            this.nextBlock = initialState.lastBlockNumber + 1;
            // TODO: Load from initial state
            this.keyVersions = {};
            const newSnapshot = new SimpleKeyValueState(this);
            for (const value of initialState.keyValueState) {
                const pair = {
                    ...value,
                    transaction: null
                };
                newSnapshot.addKeyValuePair(pair);
                const keyHex = value.key.toString("hex");
                this.keyVersions[keyHex] = [ pair ];
            }
            this.snapshot = { [initialState.lastBlockNumber]: newSnapshot };
        } else {
            this.nextBlock = 0;
            this.keyVersions = {};
            this.snapshot = {};
        }
        this.startBlock = this.nextBlock;
    }

    public getNextDesiredBlockNumber(): number {
        return this.nextBlock;
    }

    public getVersionsForKey(key: Buffer): KeyValuePairWithTx[] {
        const keyName = key.toString("hex");
        if (this.keyVersions[keyName] == null) {
            return [];
        } else {
            return this.keyVersions[keyName];
        }
    }

    public feedBlock(block: KeyValueBlock): boolean {
        if (this.nextBlock !== block.getBlockNumber()) {
            return false;
        }

        const blockNumber = block.getBlockNumber();
        let newSnapshot;
        if (this.snapshot[blockNumber - 1] == null) {
            newSnapshot = new SimpleKeyValueState(this);
        } else {
            newSnapshot = new SimpleKeyValueState(this, this.snapshot[blockNumber - 1]);
        }

        for (const tx of block.getTransactions()) {
            const rSet = tx.getReadSet();
            for (const rPair of rSet) {
                const pair = newSnapshot.getValue(rPair.key);
                if (pair.getVersion().compare(rPair.version) !== 0) {
                    throw new BCVerifierError("Read conflict detected in a valid transaction");
                }
            }

            const wSet = tx.getWriteSet();
            for (const wPair of wSet) {
                const pair = {
                    ...wPair,
                    transaction: tx
                };
                newSnapshot.addKeyValuePair(pair);
                const keyHex = wPair.key.toString("hex");
                if (this.keyVersions[keyHex] == null) {
                    this.keyVersions[keyHex] = [ pair ];
                } else {
                    this.keyVersions[keyHex].push(pair);
                }
            }
        }
        this.snapshot[block.getBlockNumber()] = newSnapshot;

        this.nextBlock = block.getBlockNumber() + 1;
        return true;
    }

    public getState(block: KeyValueBlock): SimpleKeyValueState {
        if (block.getBlockNumber() >= this.nextBlock) {
            const msg = util.format("State for block %d requested. But manager is only fed up to block %d",
                                    block.getBlockNumber(), this.nextBlock - 1);
            throw new KeyValueManagerBlockNotSufficientError(msg);
        } else if (block.getBlockNumber() < this.startBlock) {
            throw new BCVerifierNotFound();
        }
        //
        return this.snapshot[block.getBlockNumber()];
    }
}
