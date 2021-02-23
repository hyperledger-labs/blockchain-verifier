/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppStateCheckLogic, AppTransactionCheckLogic, BlockCheckPlugin, TransactionCheckPlugin } from "./check";
import { BCVerifierError, BCVerifierNotImplemented, KeyValueTransaction, Transaction,
         VerificationConfig } from "./common";
import { DataModelType, NetworkPlugin } from "./network-plugin";
import { BlockProvider, KeyValueBlockProvider } from "./provider";
import { ResultSet } from "./result-set";

type PluginInfo = { pluginName: string, moduleName: string };

const networkPlugins: PluginInfo[] = [
    { pluginName: "fabric-block", moduleName: "./network/fabric-block" },
    { pluginName: "fabric-query", moduleName: "./network/fabric-query" },
    { pluginName: "fabric-query2", moduleName: "./network/fabric-query2" }
];
const blockVerifiers: PluginInfo[] = [
    { pluginName: "generic-block", moduleName: "./check/block-integrity" },
    { pluginName: "fabric-block", moduleName: "./check/fabric-block-check" }
];
const txVerifiers: PluginInfo[] = [
    { pluginName: "fabric-transaction", moduleName: "./check/fabric-transaction-check" }
];
const multipleLedgerVerifiers: PluginInfo[] = [
    { pluginName: "multiple-ledgers", moduleName: "./check/multiple-ledgers" }
];

export class BCVerifier {
    public static getAvailableNetwork(): string[] {
        return networkPlugins.map((p) => p.moduleName);
    }

    private config: VerificationConfig;
    private network?: NetworkPlugin;
    private resultSet: ResultSet;

    private networkPlugin: PluginInfo;

    constructor(config: VerificationConfig) {
        this.config = config;

        const networkPlugin = networkPlugins.find((p) => p.pluginName === config.networkType);
        if (networkPlugin == null) {
            throw new BCVerifierError("No suitable network plugin found");
        } else {
            this.networkPlugin = networkPlugin;
        }
        this.resultSet = new ResultSet();
    }

    public async verify(): Promise<ResultSet> {
        const networkPluginModule = await import(this.networkPlugin.moduleName);
        this.network = new networkPluginModule.default(this.config.networkConfig);

        if (this.network == null) {
            throw new BCVerifierError("Failed to initialize network plugin");
        }

        const blockSource = await this.network.getPreferredBlockSource();
        let blockProvider: BlockProvider;
        if (this.network.getDataModelType() === DataModelType.KeyValue) {
            blockProvider = new KeyValueBlockProvider(blockSource);
        } else {
            blockProvider = new BlockProvider(blockSource);
        }

        const blockHeight = await blockSource.getBlockHeight();
        await blockProvider.cacheBlockRange(0, blockHeight - 1);

        const blockCheckPlugins: BlockCheckPlugin[] = [];
        for (const info of blockVerifiers) {
            const verifierModule = await import(info.moduleName);
            blockCheckPlugins.push(new verifierModule.default(blockProvider, this.resultSet));
        }
        const txCheckPlugins: TransactionCheckPlugin[] = [];
        for (const info of txVerifiers) {
            const verifierModule = await import(info.moduleName);
            txCheckPlugins.push(new verifierModule.default(blockProvider, this.resultSet));
        }

        const preferredProvider = blockProvider;
        const allSources = await this.network.getBlockSources();
        const dataModelType = this.network.getDataModelType();
        const otherProviders = allSources.filter((s) => s.getSourceID() !== preferredProvider.getSourceID())
            .map((s) => {
                if (dataModelType === DataModelType.KeyValue) {
                    return new KeyValueBlockProvider(s);
                } else {
                    return new BlockProvider(s);
                }
            });

        const multipleBlockCheckPlugins: BlockCheckPlugin[] = [];
        for (const info of multipleLedgerVerifiers) {
            const verifierModule = await import(info.moduleName);
            multipleBlockCheckPlugins.push(new verifierModule.default(preferredProvider, otherProviders, this.resultSet));
        }

        const appStateCheckers: AppStateCheckLogic[] = [];
        const appTxCheckers: AppTransactionCheckLogic[] = [];
        for (const modName of this.config.applicationCheckers) {
            const checkerModule = await import(modName);
            const checkerObject: AppStateCheckLogic & AppTransactionCheckLogic
                = new checkerModule.default(blockProvider, this.resultSet);

            if (checkerObject.probeStateCheck != null) {
                appStateCheckers.push(checkerObject);
            }
            if (checkerObject.probeTransactionCheck != null) {
                appTxCheckers.push(checkerObject);
            }
        }

        let lastTx: Transaction | null = null;
        for (let i = 0; i < blockHeight; i++) {
            const b = await blockProvider.getBlock(i);

            for (const v of blockCheckPlugins) {
                await v.performCheck(i);
            }

            for (const tx of b.getTransactions()) {
                for (const v of txCheckPlugins) {
                    await v.performCheck(tx.getTransactionID());
                }
                lastTx = tx;
            }

            if (otherProviders.length > 0) {
                for (const v of multipleBlockCheckPlugins) {
                    await v.performCheck(i);
                }
            }
        }

        if (lastTx != null && this.network.getDataModelType() === DataModelType.KeyValue) {
            const kvProvider = blockProvider as KeyValueBlockProvider;
            const lastKeyValueTx = lastTx as KeyValueTransaction;
            try {
                const stateSet = await kvProvider.getKeyValueState(lastKeyValueTx);
                for (const v of appStateCheckers) {
                    if (await v.probeStateCheck(stateSet)) {
                        await v.performStateCheck(stateSet, this.resultSet);
                    }
                }
            } catch (e) {
                if (!(e instanceof BCVerifierNotImplemented)) {
                    throw e;
                }
            }

            for (let i = 0; i < blockHeight; i++) {
                const b = await blockProvider.getBlock(i);
                for (const tx of b.getTransactions()) {
                    const appTx = kvProvider.getAppTransaction(tx.getTransactionID());
                    for (const v of appTxCheckers) {
                        if (await v.probeTransactionCheck(appTx)) {
                            await v.performTransactionCheck(appTx, this.resultSet);
                        }
                    }
                }
            }
        }

        return this.resultSet;
    }
}
