/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { AppStateCheckLogic, AppTransactionCheckLogic, BlockCheckPlugin, TransactionCheckPlugin } from "./check";
import { BCVerifierError, BCVerifierNotImplemented, KeyValueTransaction, Transaction,
         VerificationConfig, VerificationResult } from "./common";
import { DataModelType, NetworkPlugin } from "./network-plugin";
import { BlockProvider, KeyValueBlockProvider, KeyValueProviderOptions } from "./provider";
import { ResultSet } from "./result-set";
import { BCVCheckpoint } from "./checkpoint";

import FabricBlock from "./network/fabric-block";
import FabricQuery2 from "./network/fabric-query2";

import GenericBlockChecker from "./check/block-integrity";
import FabricBlockChecker from "./check/fabric-block-check";
import FabricTransactionChecker from "./check/fabric-transaction-check";
import MultipleLedgerChecker from "./check/multiple-ledgers";

type NetworkPluginInfo = { pluginName: string, module: new (configString: string) => NetworkPlugin };
type BlockCheckPluginInfo =  { pluginName: string, module: new (provider: BlockProvider, resultSet: ResultSet, checkpoint?: BCVCheckpoint) => BlockCheckPlugin };
type TransactionCheckPluginInfo = { pluginName: string, module: new (provider: BlockProvider, resultSet: ResultSet, checkpoint?: BCVCheckpoint) => TransactionCheckPlugin };
type MultipleLedgerCheckPluginInfo =  { pluginName: string, module: new (provider: BlockProvider, others: BlockProvider[], resultSet: ResultSet) => BlockCheckPlugin };

const networkPlugins: NetworkPluginInfo[] = [
    { pluginName: "fabric-block", module: FabricBlock },
    { pluginName: "fabric-query2", module: FabricQuery2 }
];

const blockVerifiers: BlockCheckPluginInfo[] = [
    { pluginName: "generic-block", module: GenericBlockChecker },
    { pluginName: "fabric-block", module: FabricBlockChecker }
];

const txVerifiers: TransactionCheckPluginInfo[] = [
    { pluginName: "fabric-transaction", module: FabricTransactionChecker }
];

const multipleLedgerVerifiers: MultipleLedgerCheckPluginInfo[] = [
    { pluginName: "multiple-ledgers", module: MultipleLedgerChecker }
];

export class BCVerifier {
    public static getAvailableNetwork(): string[] {
        return networkPlugins.map((p) => p.pluginName);
    }

    private config: VerificationConfig;
    private network?: NetworkPlugin;
    private resultSet: ResultSet;
    private networkPlugin: NetworkPluginInfo;

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

    public async verify(): Promise<VerificationResult> {
        this.network = new this.networkPlugin.module(this.config.networkConfig);

        if (this.network == null) {
            throw new BCVerifierError("Failed to initialize network plugin");
        }

        // Key-value processing can be skipped only if
        //   1) No application checker is specified AND
        //   2a) Checkpoint is not to be saved OR 2b) --skip-key-value option is specified
        const skipKV = this.config.applicationCheckers.length === 0 && (this.config.saveCheckpoint !== true || this.config.skipKeyValue === true);
        let checkpoint: BCVCheckpoint | undefined = undefined;
        let firstBlock = 0;
        if (this.config.checkpointToResume != null) {
            checkpoint = this.network.loadFromCheckpoint(this.config.checkpointToResume);
            firstBlock = checkpoint.getLastBlock() + 1;
        }

        const blockSource = await this.network.getPreferredBlockSource();
        let blockProvider: BlockProvider;
        if (this.network.getDataModelType() === DataModelType.KeyValue && !skipKV) {
            const opts: KeyValueProviderOptions = {};
            if (checkpoint != null) {
                opts.initialState = await checkpoint.getInitialKVState();
                if (opts.initialState == null) {
                    throw new BCVerifierError("Checkpoint does not contain key-value information");
                }
            }

            blockProvider = new KeyValueBlockProvider(blockSource, opts);
        } else {
            blockProvider = new BlockProvider(blockSource);
        }

        const blockHeight = await blockSource.getBlockHeight();
        let lastBlock = blockHeight - 1;
        if (firstBlock >= blockHeight) {
            throw new BCVerifierError("No block to inspect");
        }
        if (this.config.endBlock != null) {
            if (lastBlock > this.config.endBlock) {
                lastBlock = this.config.endBlock;
            }
        }
        if (this.config.checkBlockCount != null && this.config.checkBlockCount > 0) {
            if (lastBlock - firstBlock + 1 >= this.config.checkBlockCount) {
                lastBlock = firstBlock + this.config.checkBlockCount - 1;
            }
        }

        await blockProvider.cacheBlockRange(firstBlock, lastBlock);

        const blockCheckPlugins: BlockCheckPlugin[] = [];
        for (const info of blockVerifiers) {
            if (!this.config.checkersToExclude.includes(info.pluginName)) {
                blockCheckPlugins.push(new info.module(blockProvider, this.resultSet, checkpoint));
            }
        }
        const txCheckPlugins: TransactionCheckPlugin[] = [];
        for (const info of txVerifiers) {
            if (!this.config.checkersToExclude.includes(info.pluginName)) {
                txCheckPlugins.push(new info.module(blockProvider, this.resultSet, checkpoint));
            }
        }

        const preferredProvider = blockProvider;
        const allSources = await this.network.getBlockSources();
        const dataModelType = this.network.getDataModelType();
        const otherProviders = allSources.filter((s) => s.getSourceID() !== preferredProvider.getSourceID())
            .map((s) => {
                if (dataModelType === DataModelType.KeyValue && !skipKV) {
                    return new KeyValueBlockProvider(s);
                } else {
                    return new BlockProvider(s);
                }
            });

        const multipleBlockCheckPlugins: BlockCheckPlugin[] = [];
        for (const info of multipleLedgerVerifiers) {
            if (!this.config.checkersToExclude.includes(info.pluginName)) {
                multipleBlockCheckPlugins.push(new info.module(preferredProvider, otherProviders, this.resultSet));
            }
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
        for (let i = firstBlock; i <= lastBlock; i++) {
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

        if (lastTx != null && this.network.getDataModelType() === DataModelType.KeyValue && !skipKV) {
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

            for (let i = firstBlock; i <= lastBlock; i++) {
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

        const result: VerificationResult = {
            resultSet: this.resultSet
        };

        if (this.config.saveCheckpoint === true && lastTx != null) {
            result.checkpointData = await this.network.createCheckpoint(blockProvider, lastTx);
        }

        return result;
    }
}
