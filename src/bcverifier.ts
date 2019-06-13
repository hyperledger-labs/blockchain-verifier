/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppStateCheckLogic, AppTransactionCheckLogic, BlockCheckPlugin, TransactionCheckPlugin } from "./check";
import { BCVerifierError, BCVerifierNotImplemented, Transaction, VerificationConfig } from "./common";
import { NetworkPlugin } from "./network-plugin";
import { BlockProvider } from "./provider";
import { ResultSet } from "./result-set";

type PluginInfo = { pluginName: string, moduleName: string };

const networkPlugins: PluginInfo[] = [
    { pluginName: "fabric-block", moduleName: "./network/fabric-block" },
    { pluginName: "fabric-query", moduleName: "./network/fabric-query" }
];
const blockVerifiers: PluginInfo[] = [
    { pluginName: "generic-block", moduleName: "./check/block-integrity" },
    { pluginName: "fabric-block", moduleName: "./check/fabric-block-check" }
];
const txVerifiers: PluginInfo[] = [
    { pluginName: "fabric-transaction", moduleName: "./check/fabric-transaction-check"}
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
        const blockProvider = new BlockProvider(blockSource);

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
        }

        if (lastTx != null) {
            try {
                const stateSet = await lastTx.getKeyValueState();
                for (const v of appStateCheckers) {
                    if (await v.probeStateCheck(stateSet)) {
                        await v.performStateCheck(stateSet);
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
                    for (const v of appTxCheckers) {
                        if (await v.probeTransactionCheck(tx)) {
                            await v.performTransactionCheck(tx);
                        }
                    }
                }
            }
        }

        return this.resultSet;
    }
}
