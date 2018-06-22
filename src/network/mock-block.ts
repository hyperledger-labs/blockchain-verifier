/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from "util";

import { BCVerifierError, BCVerifierNotFound, BCVerifierNotImplemented, Block, HashValueType, ResultCode,
         ResultPredicate, Transaction } from "../common";
import { BlockSource } from "../network-plugin";
import { BlockProvider } from "../provider";
import { ResultSet } from "../result-set";

export type TransactionIDAndType = { id: string, type: number };

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

export const correctBlocks = [
    new MockBlock(0, Buffer.from("ABCD"), Buffer.from(""), Buffer.from("ABCD"), Buffer.from("PABCD"),
                  [ { id: "Tx1", type: 1 }, { id: "Tx2", type: 2 }]),
    new MockBlock(1, Buffer.from("XYZW"), Buffer.from("PABCD"), Buffer.from("XYZW"), Buffer.from("PABCD"),
                  [ { id: "Tx3", type: 3 }, { id: "Tx4", type: 1 }])
];
