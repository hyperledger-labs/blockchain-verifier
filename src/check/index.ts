/*
 * Copyright 2019 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppTransaction, KeyValueState } from "../common";
import { BlockProvider } from "../provider";
import { ResultSet } from "../result-set";

export abstract class CheckPlugin {
    protected provider: BlockProvider;
    protected resultSet: ResultSet;

    public constructor(provider: BlockProvider, resultSet: ResultSet) {
        this.provider = provider;
        this.resultSet = resultSet;
    }
}

export interface BlockCheckPlugin {
    performCheck(blockNumber: number): Promise<void>;
}

export interface TransactionCheckPlugin {
    performCheck(transactionID: string): Promise<void>;
}

export interface AppStateCheckLogic {
    probeStateCheck(kvState: KeyValueState): Promise<boolean>;
    performStateCheck(kvState: KeyValueState): Promise<void>;
}

export interface AppTransactionCheckLogic {
    probeTransactionCheck(tx: AppTransaction): Promise<boolean>;
    performTransactionCheck(tx: AppTransaction): Promise<void>;
}
