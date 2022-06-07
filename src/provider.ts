/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BCVerifierError, BCVerifierNotImplemented, Block,
         KeyValueBlock,  KeyValueState, KeyValueTransaction, Transaction } from "./common";
import { KeyValueManager, KeyValueManagerBlockNotSufficientError, KeyValueManagerInitialState, SimpleKeyValueManager } from "./kvmanager";
import { BlockSource } from "./network-plugin";

// Simple in-memory cacher
export class BlockProvider {
    private source: BlockSource;
    private blocks: { [blockNumber: number]: Block };
    private transactions: { [transactionID: string]: Transaction };
    private transactionTypeIndex: { [transactionType: number]: Transaction[] };

    constructor(source: BlockSource) {
        this.source = source;
        this.blocks = {};
        this.transactions = {};
        this.transactionTypeIndex = {};
    }

    public async getBlock(blockNumber: number): Promise<Block> {
        if (this.blocks[blockNumber] != null) {
            return this.blocks[blockNumber];
        } else {
            const block = await this.source.getBlock(blockNumber);

            this.blocks[blockNumber] = block;
            this.registerTransactions(block);

            return block;
        }
    }

    public async getBlockHash(blockNumber: number): Promise<Buffer> {
        if (this.blocks[blockNumber] != null) {
            return this.blocks[blockNumber].getHashValue();
        } else {
            return await this.source.getBlockHash(blockNumber);
        }
    }

    public async cacheBlockRange(blockStart: number, blockEnd: number): Promise<void> {
        if (blockStart > blockEnd) {
            throw new BCVerifierError("cacheBlockRange: invalid range");
        }
        const bs = await this.source.getBlockRange(blockStart, blockEnd);
        for (let i = 0; i < blockEnd - blockStart + 1; i++) {
            if (this.blocks[blockStart + i] == null) {
                this.blocks[blockStart + i] = bs[i];
                this.registerTransactions(bs[i]);
            }
        }
    }

    public async getTransaction(transactionId: string): Promise<Transaction> {
        if (this.transactions[transactionId] != null) {
            return this.transactions[transactionId];
        }
        try {
            const b = await this.source.findBlockByTransaction(transactionId);

            this.registerTransactions(b);
            if (this.transactions[transactionId] != null) {
                return this.transactions[transactionId];
            } else {
                throw new BCVerifierError("transaction is not found in a block where it should be in. "
                                          + "A possible bug in the block plugin.");
            }
        } catch (e) {
            if (!(e instanceof BCVerifierNotImplemented)) {
                throw e;
            }
        }
        // Fallback... get all blocks and inspect them.
        const height = await this.source.getBlockHeight();
        await this.cacheBlockRange(0, height - 1);

        if (this.transactions[transactionId] != null) {
            return this.transactions[transactionId];
        } else {
            throw new BCVerifierError("getTransaction: transaction is not found");
        }
    }

    public getSourceID(): string {
        return this.source.getSourceID();
    }

    protected registerTransactions(block: Block): void {
        const txs = block.getTransactions();
        for (const tx of txs) {
            // Update transaction ID index
            this.transactions[tx.getTransactionID()] = tx;
            // Update transaction type index
            const type = tx.getTransactionType();
            if (this.transactionTypeIndex[type] == null) {
                this.transactionTypeIndex[type] = [];
            }
            this.transactionTypeIndex[type].push(tx);
        }
    }
}

export interface KeyValueProviderOptions {
    initialState?: KeyValueManagerInitialState;
}

export class KeyValueBlockProvider extends BlockProvider {
    protected keyValueManager: KeyValueManager;

    constructor(source: BlockSource, opts?: KeyValueProviderOptions) {
        super(source);
        if (opts == null) {
            this.keyValueManager = new SimpleKeyValueManager();
        } else {
            this.keyValueManager = new SimpleKeyValueManager(opts.initialState);
        }
    }

    public async getKeyValueState(tx: KeyValueTransaction): Promise<KeyValueState> {
        try {
            return this.keyValueManager.getState(tx.getBlock() as KeyValueBlock);
        } catch (e) {
            if (!(e instanceof KeyValueManagerBlockNotSufficientError)) {
                throw e;
            }
        }
        // Slow path: feed sufficient blocks
        const blockNum = tx.getBlock().getBlockNumber();

        while (this.keyValueManager.getNextDesiredBlockNumber() <= blockNum) {
            const nextBlock = this.keyValueManager.getNextDesiredBlockNumber();
            const block = await this.getBlock(nextBlock);

            this.keyValueManager.feedBlock(block as KeyValueBlock);
        }

        return this.keyValueManager.getState(tx.getBlock() as KeyValueBlock);
    }

    public getAppTransaction(transactionId: string) {
        return this.keyValueManager.getTransaction(transactionId);
    }

    protected registerTransactions(block: Block): void {
        super.registerTransactions(block);
        this.registerKeyValue(block as KeyValueBlock);
    }

    protected registerKeyValue(block: KeyValueBlock): void {
        this.keyValueManager.feedBlock(block);
    }
}
