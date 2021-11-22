/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { ResultSet } from "./result-set";
import { BCVCheckpointData } from "./checkpoint";

export interface VerificationConfig {
    networkType: string;
    networkConfig: string;

    applicationCheckers: string[];
    checkersToExclude: string[];

    saveCheckpoint: boolean;
    skipKeyValue: boolean;
    checkpointToResume?: BCVCheckpointData;

    endBlock?: number;
    checkBlockCount?: number;
}

export interface VerificationResult {
    resultSet: ResultSet;
    checkpointData?: BCVCheckpointData;
}

export enum ResultCode {
    OK = 0,
    ERROR = 1,
    SKIPPED = 2
}

export enum ResultPredicate {
    EQ = 0,
    EQBIN = 1,
    INVOKE = 2,
    LT = 3,
    LE = 4,
    GT = 5,
    GE = 6,
}

export type ResultOperand = {
    name: string;
    value: any;
};

export type CheckResult = {
    checkerID: string;
    result: ResultCode.OK | ResultCode.ERROR;
    predicate: ResultPredicate;
    operands: ResultOperand[];
} | {
    checkerID: string;
    result: ResultCode.SKIPPED;
    skipReason: string;
};

export interface BlockResult {
    number: number;
    block: Block;
    results: CheckResult[];
}

export interface TransactionResult {
    transactionID: string;
    blockNumber: number;
    index: number;
    results: CheckResult[];
}

export interface StateResult {
    results: CheckResult[];
}

export class BCVerifierError extends Error {
}
export class BCVerifierNotImplemented extends Error {
}
export class BCVerifierNotFound extends Error {
}

export enum HashValueType {
    HASH_FOR_SELF = 1,
    HASH_FOR_PREV = 2
}

export interface Block {
    getRaw(): Buffer;
    getBlockNumber(): number;

    getHashValue(): Buffer;
    getPrevHashValue(): Buffer;

    calcHashValue(hashType: HashValueType): Buffer;

    getTransactions(): Transaction[];
}

export interface Transaction {
    getBlock(): Block;
    getIndexInBlock(): number;
    getTransactionID(): string;
    getTransactionType(): number;
}

export interface KeyValueBlock extends Block {
    getTransactions(): KeyValueTransaction[];
}
export interface KeyValueTransaction extends Transaction {
    getReadSet(): KeyValuePairRead[];
    getWriteSet(): KeyValuePair[];
}

export type KeyValuePair = KeyValuePairWrite | KeyValuePairDelete;

export interface KeyValuePairRead {
    key: Buffer;
    version: Buffer;
}
export interface KeyValuePairWrite {
    isDelete: false;
    key: Buffer;
    value: Buffer;
    version: Buffer;
}
export interface KeyValuePairDelete {
    isDelete: true;
    key: Buffer;
    version: Buffer;
}

export interface KeyValue {
    getKey(): Buffer;
    getValue(): Buffer;
    getVersion(): Buffer;
    getHistory(): Promise<KeyValue[]>;
    getTransaction(): Promise<Transaction | null>;
}

export interface KeyValueState {
    getKeys(): KeyValue[];
    getValue(key: Buffer): KeyValue;
}

export interface AppTransaction {
    getInput(): KeyValuePair[];
    getOutput(): KeyValuePair[];
    getState(): KeyValueState;
    getTransaction(): Transaction;
}
