/*
 * Copyright 2018-2022 Hitachi America, Ltd. & Hitachi, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { openSync, read, readFileSync, readSync, statSync } from "fs";
import { Level } from "level";
import * as path from "path";
import { format } from "util";

import { BCVerifierError, BCVerifierNotImplemented, Transaction } from "../common";
import { FabricBlock, FabricTransaction } from "../data/fabric";
import { FabricBCVCheckpoint, FabricBCVCheckpointContext, FabricBCVCheckpointData } from "../data/fabric/fabric-bcv-checkpoint";
import { FabricConfigCache } from "../data/fabric/fabric-utils";
import { BlockSource, DataModelType, NetworkPlugin } from "../network-plugin";
import { BlockProvider, KeyValueBlockProvider } from "../provider";
import { BCVCheckpoint, BCVCheckpointData } from "../checkpoint";

type FabricBlockConfigSet = FabricBlockConfig[];

interface FabricBlockConfig {
    name?: string;
    blockFile?: string;
    ledgerStore?: string;
    privateDataStore?: string;
    stateLevelDB?: string;
}

type FabricBlockFileInfo = FabricBlockPosition[];

interface FabricBlockPosition {
    file: number;
    offset: number;
    size: number;
}

function getConfig(config: string): FabricBlockConfigSet {
    /*
     * For compatibility, the config is assumed to be a path to the block file
     * unless it is a path to the json file (judged by the extension).
     */
    if (config === "") {
        throw new BCVerifierError("fabric-block plugin: config should be a path to json or block file");
    } else if (config.toLowerCase().endsWith(".json")) {
        return JSON.parse(readFileSync(config, { encoding: "utf-8" }));
    } else {
        const st = statSync(config);
        if (st.isDirectory()) {
            return [{ name: "blockDir", ledgerStore: config }];
        } else {
            return [{ name: "block", blockFile: config }];
        }
    }
}

function readVarInt(file: number, position: number): [number, number] {
    let ret = 0;
    let value = 0;
    const buf = Buffer.alloc(1);
    let numByte = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (readSync(file, buf, 0, 1, position) !== 1) {
            throw new BCVerifierError("Cannot read varint from a block file");
        }
        value = buf.readUInt8(0);

        // eslint-disable-next-line no-bitwise
        ret |= (value & 0x7f) << (7 * numByte);
        numByte++;

        // eslint-disable-next-line no-bitwise
        if (!(value & 0x80)) {
            return [ret, numByte];
        }

        position++;
    }
}

export class FabricBlockSource implements BlockSource {
    public static async createFromConfig(config: FabricBlockConfig): Promise<FabricBlockSource> {
        const blockInfo: FabricBlockFileInfo = [];

        let file;
        if (config.blockFile != null) {
            file = openSync(config.blockFile, "r");
        } else if (config.ledgerStore != null) {
            file = openSync(path.join(config.ledgerStore, "blockfile_000000"), "r");
        } else {
            throw new BCVerifierError("Cannot find ledger file");
        }

        try {
            let position = 0;
            let size = 0;
            let len = 0;

            // eslint-disable-next-line no-constant-condition
            while (true) {
                [size, len] = readVarInt(file, position);
                if (size > 0) {
                    blockInfo.push({ file: file, offset: position + len, size: size });
                    position += len + size;
                } else {
                    break;
                }
            }
        } catch (e) {
            // Read until EOF.
        }

        let privateDB = null;
        if (config.privateDataStore != null) {
            privateDB = new Level(config.privateDataStore,
                                  { createIfMissing: false, keyEncoding: "binary", valueEncoding: "binary" });
        }

        return new FabricBlockSource(config, file, blockInfo, privateDB);
    }

    private file: number;
    private blockInfo: FabricBlockFileInfo;
    private config: FabricBlockConfig;
    private privateDB: Level | null;

    private constructor(config: FabricBlockConfig, file: number, blockInfo: FabricBlockFileInfo, privateDB: Level | null) {
        this.file = file;
        this.blockInfo = blockInfo;
        this.config = config;
        this.privateDB = privateDB;
    }

    public getBlock(blockNumber: number): Promise<FabricBlock> {
        const bi = this.blockInfo[blockNumber];

        if (bi == null) {
            throw new BCVerifierError(format("Block %d not found", blockNumber));
        }
        const buffer = Buffer.alloc(bi.size);

        return new Promise((resolve, reject) => {
            read(this.file, buffer, 0, bi.size, bi.offset,
                 (err, bytesRead, bufferRead) => {
                     if (err == null && bytesRead === bi.size) {
                         const b = FabricBlock.fromFileBytes(bufferRead);
                         if (this.privateDB != null) {
                             b.addPrivateData(this.privateDB).then(() => {
                                 resolve(b);
                             }, (error) => { reject(error); });
                         } else {
                             resolve(b);
                         }
                     } else {
                         reject(err);
                     }
                 }
            );
        });
    }

    public async getBlockHash(blockNumber: number): Promise<Buffer> {
        const block = await this.getBlock(blockNumber);

        return block.getHashValue();
    }

    public async getBlockHeight(): Promise<number> {
        return this.blockInfo.length;
    }

    public async getBlockRange(blockStart: number, blockEnd: number): Promise<FabricBlock[]> {
        let b = 0;
        const result: FabricBlock[] = [];
        if (blockEnd < blockStart) {
            throw new BCVerifierError(format("Block range invalid (start: %d, end %d)", blockStart, blockEnd));
        }
        // No special method defined. Just get blocks one by one
        for (b = blockStart; b <= blockEnd; b++) {
            result.push(await this.getBlock(b));
        }
        return result;
    }

    public getSourceID(): string {
        if (this.config.name != null) {
            return this.config.name;
        } else if (this.config.ledgerStore != null) {
            return this.config.ledgerStore;
        } else if (this.config.blockFile != null) {
            return this.config.blockFile;
        } else {
            return "block";
        }
    }

    public getSourceOrganizationID(): string {
        return "file";
    }

    public async findBlockByTransaction(_transactionId: string): Promise<FabricBlock> {
        // No special function for finding a transaction.
        // Throw a not-implemented exception to make the provider to perform a slow-path
        throw new BCVerifierNotImplemented("findBlockByTransaction is not implemented");
    }

    public closePrivateDB(): Promise<void> {
        if (this.privateDB) {
            return this.privateDB.close();
        } else {
            return Promise.resolve();
        }
    }
}

export default class FabricBlockPlugin implements NetworkPlugin {
    private sources: FabricBlockSource[] | undefined;
    private configSet: FabricBlockConfigSet;

    constructor(configString: string) {
        this.configSet = getConfig(configString);
    }

    public getDataModelType(): DataModelType {
        return DataModelType.KeyValue;
    }

    public async getBlockSources(): Promise<FabricBlockSource[]> {
        if (this.sources == null) {
            this.sources = [];
            for (const i in this.configSet) {
                const config = this.configSet[i];
                if (config.name == null) {
                    config.name = "Source " + i;
                }
                this.sources.push(await FabricBlockSource.createFromConfig(config));
            }
        }
        return this.sources;
    }

    public async getPreferredBlockSource(): Promise<FabricBlockSource> {
        const sources = await this.getBlockSources();
        if (sources.length === 0) {
            throw new BCVerifierError("No Block Source found");
        }
        return sources[0];
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

        const checkpoint = new FabricBCVCheckpoint("fabric-block", null, context);

        return await checkpoint.getCheckpoint();
    }

    public loadFromCheckpoint(data: BCVCheckpointData): BCVCheckpoint {
        const fabricCheckpointData = data as FabricBCVCheckpointData;

        return new FabricBCVCheckpoint("fabric-block", fabricCheckpointData);
    }
}
