/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { openSync, read, readSync } from "fs";
import { format } from "util";

import { BCVerifierError, BCVerifierNotImplemented, Block } from "../common";
import { FabricBlock } from "../data/fabric-data";
import { BlockSource, NetworkPlugin } from "../network-plugin";

function readVarInt(file: number, position: number | null): [number, number] {
    let ret = 0;
    let value = 0;
    const buf = Buffer.alloc(1);
    let numByte = 0;

    while (true) {
        if (readSync(file, buf, 0, 1, position) !== 1) {
            throw new BCVerifierError("Cannot read varint from a block file");
        }
        value = buf.readUInt8(0);

        // tslint:disable-next-line: no-bitwise
        ret |= (value & 0x7f) << (7 * numByte);
        numByte++;

        // tslint:disable-next-line: no-bitwise
        if (!(value & 0x80)) {
            return [ret, numByte];
        }

        if (position != null) {
            position++;
        }
    }
}

export class FabricBlockSource implements BlockSource {
    private blockFileName: string;
    private file: number;
    private blockInfo: Array<{ offset: number, size: number }>;

    constructor(config: string) {
        this.blockFileName = config;

        this.file = openSync(this.blockFileName, "r");
        this.blockInfo = [];

        try {
            let position = 0;
            let size = 0;
            let len = 0;

            while (true) {
                [size, len] = readVarInt(this.file, position);
                if (size > 0) {
                    this.blockInfo.push({ offset: position + len, size: size });
                    position += len + size;
                } else {
                    break;
                }
            }
        } catch (e) {
            // Read until EOF.
        }
    }

    public getBlock(blockNumber: number): Promise<Block> {
        const bi = this.blockInfo[blockNumber];

        if (bi == null) {
            throw new BCVerifierError(format("Block %d not found", blockNumber));
        }
        const buffer = Buffer.alloc(bi.size);

        return new Promise((resolve, reject) => {
            read(this.file, buffer, 0, bi.size, bi.offset,
                (err, bytesRead, bufferRead) => {
                    if (err == null && bytesRead === bi.size) {
                        resolve(FabricBlock.fromBytes(bufferRead));
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
    public async getBlockRange(blockStart: number, blockEnd: number): Promise<Block[]> {
        let b = 0;
        const result: Block[] = [];
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
        return this.blockFileName;
    }
    public getSourceOrganizationID(): string {
        return "file";
    }

    public findBlockByTransaction(transactionId: string): Promise<Block> {
        // No special function for finding a transaction.
        // Throw an not-implemented exception to make the provider to perform a slow-path
        throw new BCVerifierNotImplemented("findBlockByTransaction is not implemented");
    }
}

export default class FabricBlockPlugin implements NetworkPlugin {
    private sources: FabricBlockSource[];

    constructor(config: string) {
        if (config === "") {
            throw new BCVerifierError("fabric-block plugin: config should be the block filename");
        }
        this.sources = [ new FabricBlockSource(config) ];
    }

    public async getBlockSources(): Promise<BlockSource[]> {
        return this.sources;
    }
    public async getPreferredBlockSource(): Promise<BlockSource> {
        return this.sources[0];
    }
}
