/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from "util";

import { BCVerifierError, BCVerifierNotFound, BCVerifierNotImplemented, Block,
         HashValueType, KeyValueBlock, KeyValuePair, KeyValuePairRead,
         KeyValueState, KeyValueTransaction, Transaction, } from "../common";
import { BlockSource } from "../network-plugin";

export type TransactionIDAndType = { id: string, type: number };
export type KVTransactionIDAndType = TransactionIDAndType & { rwset: SampleRWSet };

export class MockTransaction implements Transaction {
    private transactionID: string;
    private transactionType: number;
    private block: Block;
    private index: number;

    constructor(block: Block, args: TransactionIDAndType, index: number) {
        this.transactionID = args.id;
        this.transactionType = args.type;
        this.block = block;
        this.index = index;
    }

    public getBlock(): Block {
        return this.block;
    }

    public getIndexInBlock(): number {
        return this.index;
    }

    public getTransactionID(): string {
        return this.transactionID;
    }

    public getTransactionType(): number {
        return this.transactionType;
    }

    public async getKeyValueState(): Promise<KeyValueState> {
        throw new BCVerifierNotImplemented();
    }
}

export class MockBlock implements Block {
    private blockNumber: number;
    private hashSelf: Buffer;
    private hashPrev: Buffer;
    private calcHashSelf: Buffer;
    private calcHashPrev: Buffer;
    private transactions: Transaction[];

    constructor(num: number, hashSelf: Buffer, hashPrev: Buffer, calcHashSelf: Buffer, calcHashPrev: Buffer,
                transactions: TransactionIDAndType[]) {
        this.blockNumber = num;
        this.hashSelf = hashSelf;
        this.hashPrev = hashPrev;
        this.calcHashSelf = calcHashSelf;
        this.calcHashPrev = calcHashPrev;

        this.transactions = [];
        for (const i in transactions) {
            const transaction = transactions[i];
            this.transactions.push(new MockTransaction(this, transaction, parseInt(i, 10)));
        }
    }

    public getBlockNumber(): number {
        return this.blockNumber;
    }

    public getHashValue(): Buffer {
        return this.hashSelf;
    }

    public getPrevHashValue(): Buffer {
        return this.hashPrev;
    }

    public calcHashValue(hash: HashValueType) {
        switch (hash) {
            case HashValueType.HASH_FOR_PREV:
                return this.calcHashPrev;
            case HashValueType.HASH_FOR_SELF:
                return this.calcHashSelf;
        }
    }

    public getRaw(): Buffer {
        return Buffer.alloc(0);
    }

    public getTransactions(): Transaction[] {
        return this.transactions;
    }
}

export class MockSource implements BlockSource {
    private sourceID: string;
    private orgID: string;
    private blocks: Block[];
    private useFindTransaction: boolean;

    constructor(sourceID: string, orgID: string, blocks: Block[], useFindTransaction?: boolean) {
        this.sourceID = sourceID;
        this.orgID = orgID;
        this.blocks = blocks;
        if (useFindTransaction == null || !useFindTransaction) {
            this.useFindTransaction = false;
        } else {
            this.useFindTransaction = true;
        }
    }

    public getSourceID() {
        return this.sourceID;
    }

    public getSourceOrganizationID() {
        return this.orgID;
    }

    public async getBlock(num: number): Promise<Block> {
        if (num < 0 || num >= this.blocks.length) {
            throw new BCVerifierError(format("Block %d not found", num));
        }
        return this.blocks[num];
    }

    public async getBlockHash(num: number): Promise<Buffer> {
        if (num < 0 || num >= this.blocks.length) {
            throw new BCVerifierError(format("Block %d not found", num));
        }
        return this.blocks[num].getHashValue();
    }

    public async getBlockHeight(): Promise<number> {
        return this.blocks.length;
    }

    public async getBlockRange(start: number, end: number): Promise<Block[]> {
        return this.blocks.slice(start, end + 1);
    }

    public async findBlockByTransaction(transactionID: string): Promise<Block> {
        if (this.useFindTransaction) {
            for (const b of this.blocks) {
                const txs = b.getTransactions();
                for (const tx of txs) {
                    if (tx.getTransactionID() === transactionID) {
                        return b;
                    }
                }
            }
            throw new BCVerifierNotFound("Block not found");
        } else {
            throw new BCVerifierNotImplemented();
        }
    }
}

export class MockKVTransaction extends MockTransaction implements KeyValueTransaction {
    private writeSet: KeyValuePair[];
    private readSet: KeyValuePairRead[];

    constructor(block: KeyValueBlock, transaction: KVTransactionIDAndType, index: number) {
        super(block, transaction, index);

        this.readSet = [];
        for (const key in transaction.rwset.read) {
            const version = transaction.rwset.read[key];

            this.readSet.push({
                key: Buffer.from(key),
                version: Buffer.from(version)
            });
        }

        this.writeSet = [];
        for (const key in transaction.rwset.write) {
            const value = transaction.rwset.write[key];
            if (value != null) {
                this.writeSet.push({
                    isDelete: false,
                    key: Buffer.from(key),
                    value: Buffer.from(value),
                    version: Buffer.from(block.getBlockNumber() + "*" + index)
                });
            } else {
                this.writeSet.push({
                    isDelete: true,
                    key: Buffer.from(key),
                    version: Buffer.from(block.getBlockNumber() + "*" + index)
                });
            }
        }
    }

    public getWriteSet() {
        return this.writeSet;
    }

    public getReadSet() {
        return this.readSet;
    }
}

export class MockKVBlock extends MockBlock implements KeyValueBlock {
    private kvTransactions: KeyValueTransaction[];

    constructor(num: number, hashSelf: Buffer, hashPrev: Buffer, calcHashSelf: Buffer, calcHashPrev: Buffer,
                transactions: KVTransactionIDAndType[]) {
        super(num, hashSelf, hashPrev, calcHashSelf, calcHashPrev, transactions);

        this.kvTransactions = [];
        for (const transaction of transactions) {
            this.kvTransactions.push(new MockKVTransaction(
                this, transaction, this.kvTransactions.length
            ));
        }
    }

    public getTransactions(): KeyValueTransaction[] {
        return this.kvTransactions;
    }
}

export const correctBlocks = [
    new MockBlock(0, Buffer.from("ABCD"), Buffer.from(""), Buffer.from("ABCD"), Buffer.from("PABCD"),
                  [ { id: "Tx1", type: 1 }, { id: "Tx2", type: 2 }]),
    new MockBlock(1, Buffer.from("XYZW"), Buffer.from("PABCD"), Buffer.from("XYZW"), Buffer.from("PABCD"),
                  [ { id: "Tx3", type: 3 }, { id: "Tx4", type: 1 }])
];

interface SampleRWSet {
    read: { [key: string]: string };
    write: { [key: string]: string | null };
}

export const sampleRWSets: SampleRWSet[] = [
    { read: {}, write: {} }, // 0
    { read: {}, write: { key1: "A" }}, // 1 (Used in 0-0)
    { read: { key1: "0*0" }, write: { key2: "1", key3: "foo" }}, // 2 (Used in 1-1)
    { read: { key2: "1*1" }, write: { key1: "B", key2: "3", key3: null }}, // 3 (Used in 2-0)
    { read: { key1: "2*0" }, write: { key1: null, key3: "bar" }} // 4 (Used in 2-1)
];

export const correctKVBlocks = [
    new MockKVBlock(0, Buffer.from("ABCD"), Buffer.from(""), Buffer.from("ABCD"), Buffer.from("PABCD"),
                    [ { id: "Tx1", type: 1, rwset: sampleRWSets[1] }, { id: "Tx2", type: 2, rwset: sampleRWSets[0] }]),
    new MockKVBlock(1, Buffer.from("XYZW"), Buffer.from("PABCD"), Buffer.from("XYZW"), Buffer.from("PABCD"),
                    [ { id: "Tx3", type: 3, rwset: sampleRWSets[0] }, { id: "Tx4", type: 1, rwset: sampleRWSets[2] }]),
    new MockKVBlock(2, Buffer.from("EFGH"), Buffer.from("XYZW"), Buffer.from("EFGH"), Buffer.from("XYZW"),
                    [ { id: "Tx5", type: 1, rwset: sampleRWSets[3] }, { id: "Tx6", type: 1, rwset: sampleRWSets[4] }]),
];
