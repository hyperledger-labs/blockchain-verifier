/*
 * Copyright 2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { Channel, Client, ConnectOptions, Endorser, IdentityContext, Query, User } from "fabric-common";
import { common } from "fabric-protos";
import fs from "fs";
import util from "util";

import { BCVerifierError, Transaction } from "../common";
import { FabricBlock, FabricTransaction } from "../data/fabric";
import { FabricBCVCheckpoint, FabricBCVCheckpointContext, FabricBCVCheckpointData } from "../data/fabric/fabric-bcv-checkpoint";
import { FabricConfigCache } from "../data/fabric/fabric-utils";
import { BlockSource, DataModelType, NetworkPlugin } from "../network-plugin";
import { BlockProvider, KeyValueBlockProvider } from "../provider";
import { BCVCheckpoint, BCVCheckpointData } from "../checkpoint";

const QUERY_SYSTEM_CHAINCODE = "qscc";
const FUNC_GET_BLOCK = "GetBlockByNumber";
const FUNC_GET_BLOCK_BY_TXID = "GetBlockByTxID";
const FUNC_GET_CHAIN_INFO = "GetChainInfo";

type FabricQuery2PluginDiscoveryConfig = {
    useDiscovery: false;
};

interface FabricQuery2PluginPeerConfig {
    url: string;
    mspID: string;
    tlsCACertFile?: string;
}

export interface FabricQuery2PluginConfig {
    peer?: FabricQuery2PluginPeerConfig;
    peers?: FabricQuery2PluginPeerConfig[];
    channel: string;
    client: {
        certFile: string;
        keyFile: string;
        mspID: string;
        mutualTLS?: {
            certFile: string;
            keyFile: string;
        }
    };
    config: FabricQuery2PluginDiscoveryConfig;
}

export class FabricQuery2Source implements BlockSource {
    protected client: Client;
    protected channel: Channel;
    protected identity: IdentityContext;
    protected peer: Endorser | null;
    protected query: Query;
    protected config: FabricQuery2PluginConfig;
    protected peerConfig: FabricQuery2PluginPeerConfig;

    public constructor(config: FabricQuery2PluginConfig, peer: FabricQuery2PluginPeerConfig) {
        this.client = Client.newClient("peer");
        this.channel = this.client.newChannel(config.channel);
        this.peer = null;
        this.query = this.channel.newQuery(QUERY_SYSTEM_CHAINCODE);
        this.config = config;
        this.peerConfig = peer;

        this.identity = this.client.newIdentityContext(
            User.createUser("user", "",
                            this.config.client.mspID,
                            fs.readFileSync(this.config.client.certFile).toString(),
                            fs.readFileSync(this.config.client.keyFile).toString()
            ));
    }

    public async init() {
        this.peer = this.client.newEndorser("peer1");

        const opts: ConnectOptions = {
            url: this.peerConfig.url
        };
        if (this.peerConfig.tlsCACertFile != null) {
            opts.pem = fs.readFileSync(this.peerConfig.tlsCACertFile).toString();
        }
        if (this.config.client.mutualTLS != null) {
            opts.clientCert = fs.readFileSync(this.config.client.mutualTLS.certFile).toString();
            opts.clientKey = fs.readFileSync(this.config.client.mutualTLS.keyFile).toString();
        }

        await this.peer.connect(
            this.client.newEndpoint(opts)
        );
    }

    public getSourceID(): string {
        return util.format("%s", this.peerConfig.url);
    }

    public getSourceOrganizationID(): string {
        return this.peerConfig.mspID;
    }

    public async getBlock(blockNumber: number): Promise<FabricBlock> {
        const blockBytes = await this.queryChaincode(FUNC_GET_BLOCK, this.config.channel, blockNumber.toString());

        return FabricBlock.fromQueryBytes(blockBytes);
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
        const infoBytes = await this.queryChaincode(FUNC_GET_CHAIN_INFO, this.config.channel);
        const info = common.BlockchainInfo.decode(infoBytes);

        if (typeof(info.height) === "number") {
            return info.height;
        } else {
            return info.height.toNumber();
        }
    }

    public async findBlockByTransaction(txID: string): Promise<FabricBlock> {
        const block = await this.queryChaincode(FUNC_GET_BLOCK_BY_TXID, this.config.channel, txID);

        return FabricBlock.fromQueryBytes(block);
    }

    protected async queryChaincode(func: string, ...args: string[]): Promise<Buffer> {
        if (this.peer == null) {
            throw new BCVerifierError("FabricQuery2Source not initialized");
        }

        this.query.build(this.identity, {
            fcn: func,
            args: args
        });
        this.query.sign(this.identity);
        const response = await this.query.send({
            targets: [this.peer]
        });

        if (response.queryResults.length < 1) {
            throw new BCVerifierError("Peer returned error: " + response.responses[0].response.message);
        } else {
            return response.queryResults[0];
        }
    }
}

export default class FabricQuery2Plugin implements NetworkPlugin {
    private sources: FabricQuery2Source[] | null;
    private pluginConfig: FabricQuery2PluginConfig;

    public constructor(config: string) {
        if (config === "") {
            throw new BCVerifierError("fabric-query2 plugin: config should be the configuration file");
        }
        this.pluginConfig = JSON.parse(fs.readFileSync(config).toString());
        this.sources = null;
    }

    public getDataModelType(): DataModelType {
        return DataModelType.KeyValue;
    }

    public async getBlockSources(): Promise<BlockSource[]> {
        if (this.sources == null) {
            if (this.pluginConfig.peers) {
                this.sources = [];
                for (const peer of this.pluginConfig.peers) {
                    const blockSource = new FabricQuery2Source(this.pluginConfig, peer);
                    await blockSource.init();

                    this.sources.push(blockSource);
                }
            } else if (this.pluginConfig.peer) {
                const blockSource = new FabricQuery2Source(this.pluginConfig, this.pluginConfig.peer);
                await blockSource.init();

                this.sources = [blockSource];
            } else {
                throw new BCVerifierError("fabric-query2 Plugin: No peer is specified in the config")
            }
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
            throw new BCVerifierError("fabric-query2 Plugin: Cannot find any source");
        }
    }

    public async createCheckpoint(provider: BlockProvider, transaction: Transaction): Promise<BCVCheckpointData> {
        const kvProvider = provider as KeyValueBlockProvider;
        const fabricTransaction = transaction as FabricTransaction;

        const lastBlock = fabricTransaction.getBlock();
        const configBlockIndex = lastBlock.getLastConfigBlockIndex();
        const configInfo = await FabricConfigCache.GetInstance().getConfig(configBlockIndex);

        const context: FabricBCVCheckpointContext = {
            block: lastBlock,
            configInfo: configInfo,
            transaction: fabricTransaction,
            timestamp: Date.now(),
        };

        if (kvProvider instanceof KeyValueBlockProvider) {
            const state = await kvProvider.getKeyValueState(fabricTransaction);
            context.state = state;
        }

        const checkpoint = new FabricBCVCheckpoint("fabric-query2", null, context);

        return await checkpoint.getCheckpoint();
    }

    public loadFromCheckpoint(data: BCVCheckpointData): BCVCheckpoint {
        const fabricCheckpointData = data as FabricBCVCheckpointData;

        return new FabricBCVCheckpoint("fabric-query2", fabricCheckpointData);
    }
}
