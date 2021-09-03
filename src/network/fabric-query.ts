/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import Client, { Channel } from "fabric-client";
import * as fs from "fs";
import * as util from "util";
import { BCVerifierError, Transaction } from "../common";
import { FabricBlock, FabricTransaction } from "../data/fabric";
import { FabricBCVSnapshot } from "../data/fabric/fabric-bcv-snapshot";
import { BlockSource, DataModelType, NetworkPlugin } from "../network-plugin";
import { BlockProvider, KeyValueBlockProvider } from "../provider";
import { BCVSnapshotData } from "../snapshot";

type FabricQueryPluginClientConfig = {
    mspID: string;
    peerName: string;
    channelName: string;
    credentials: {
        useAdmin: false;
        mutualTLS: boolean;
        userName: string;
        certFile: string;
        keyFile: string;
    } | {
        useAdmin: true;
        orgName: string;
        mutualTLS: false;
    };
};

interface FabricQueryPluginConfig {
    connectionProfile: string;
    useDiscovery: boolean;
    client: FabricQueryPluginClientConfig;
}

export class FabricQuerySource implements BlockSource {
    private client: Client;
    private channel: Channel | undefined;
    private clientConfig: FabricQueryPluginClientConfig;

    constructor(client: Client, clientConfig: FabricQueryPluginClientConfig) {
        this.client = client;
        this.clientConfig = clientConfig;
    }

    public async init(): Promise<void> {
        const credentials = this.clientConfig.credentials;

        if (!credentials.useAdmin) {
            const clientCert = fs.readFileSync(credentials.certFile).toString();
            const clientKey = fs.readFileSync(credentials.keyFile).toString();

            if (credentials.mutualTLS) {
                this.client.setTlsClientCertAndKey(clientCert, clientKey);
            }
            await this.client.createUser({
                username: credentials.userName,
                mspid: this.clientConfig.mspID,
                skipPersistence:  true,
                cryptoContent: {
                    signedCertPEM: clientCert,
                    privateKeyPEM: clientKey
                }
            });
        } else {
            this.client.loadFromConfig({
                name: credentials.orgName + "-client",
                version: "1.0",
                client: {
                    organization: credentials.orgName
                }
            });
        }
        this.channel = this.client.getChannel(this.clientConfig.channelName);
        await this.channel.initialize();
    }

    public getSourceID(): string {
        return util.format("%s", this.clientConfig.peerName);
    }
    public getSourceOrganizationID(): string {
        return this.clientConfig.mspID;
    }
    public async getBlock(blockNumber: number): Promise<FabricBlock> {
        if (this.channel == null) {
            throw new BCVerifierError("fabric client is not initialized. Call init()");
        }
        const block = await this.channel.queryBlock(blockNumber, this.clientConfig.peerName,
                                                    this.clientConfig.credentials.useAdmin, true);
        return FabricBlock.fromQueryBytes(block);
    }
    public async getBlockRange(blockStart: number, blockEnd: number): Promise<FabricBlock[]> {
        const result: FabricBlock[] = [];
        if (blockEnd < blockStart) {
            throw new BCVerifierError(util.format("Block range invalid (start: %d, end %d)", blockStart, blockEnd));
        }

        let b: number;
        for (b = blockStart; b <= blockEnd; b++) {
            result.push(await this.getBlock(b));
        }
        return result;
    }
    public async getBlockHash(blockNumber: number): Promise<Buffer> {
        const block = await this.getBlock(blockNumber);

        return block.getHashValue();
    }
    public async getBlockHeight(): Promise<number> {
        if (this.channel == null) {
            throw new BCVerifierError("fabric client is not initialized. Call init()");
        }
        const info = await this.channel.queryInfo(this.clientConfig.peerName,
                                                  this.clientConfig.credentials.useAdmin);

        return info.height;
    }
    public async findBlockByTransaction(txID: string): Promise<FabricBlock> {
        if (this.channel == null) {
            throw new BCVerifierError("fabric client is not initialized. Call init()");
        }
        const buf = await this.channel.queryBlockByTxID(txID, this.clientConfig.peerName,
                                                        this.clientConfig.credentials.useAdmin, true);
        return FabricBlock.fromQueryBytes(buf);
    }
}

export default class FabricQueryPlugin implements NetworkPlugin {
    private sources: FabricQuerySource[] | undefined;
    private pluginConfig: FabricQueryPluginConfig;

    constructor(config: string) {
        if (config === "") {
            throw new BCVerifierError("fabric-query plugin: config should be the configuration file");
        }
        this.pluginConfig = JSON.parse(fs.readFileSync(config).toString());

        if (this.pluginConfig.useDiscovery) {
            Client.setConfigSetting("initialize-with-discovery", true);
        }
    }

    public getDataModelType(): DataModelType {
        return DataModelType.KeyValue;
    }

    public async getBlockSources(): Promise<BlockSource[]> {
        if (this.sources == null) {
            // We use different "Client" objects for different sources
            const client = Client.loadFromConfig(this.pluginConfig.connectionProfile);
            // ... but currently, only one source is used.
            const blockSource = new FabricQuerySource(client, this.pluginConfig.client);
            await blockSource.init();
            this.sources = [blockSource];
        }
        return this.sources;
    }

    public async getPreferredBlockSource(): Promise<BlockSource> {
        if (this.sources == null) {
            await this.getBlockSources();
        }
        if (this.sources != null && this.sources.length > 0) {
            return this.sources[0];
        } else {
            throw new BCVerifierError("FabricQuery Plugin: Cannot find any source");
        }
    }

    public async createSnapshot(provider: BlockProvider, transaction: Transaction): Promise<BCVSnapshotData> {
        const kvProvider = provider as KeyValueBlockProvider;
        const fabricTransaction = transaction as FabricTransaction;

        const lastBlock = fabricTransaction.getBlock();
        const configBlockIndex = lastBlock.getLastConfigBlockIndex();
        const configBlock = await kvProvider.getBlock(configBlockIndex) as FabricBlock;
        const state = await kvProvider.getKeyValueState(fabricTransaction);

        const snapshot = new FabricBCVSnapshot("fabric-query", null, {
            block: lastBlock,
            configBlock: configBlock,
            transaction: fabricTransaction,
            state: state,
            timestamp: Date.now(),
        });

        return await snapshot.getSnapshot();
    }
}
