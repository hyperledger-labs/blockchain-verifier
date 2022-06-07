/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Integer, OctetString, Sequence } from "asn1js";
import { createHash } from "crypto";
import BlockDecoder from "fabric-common/lib/BlockDecoder";
import { format } from "util";
import { BlockData, MSPConfig } from "./fabric-types";

import { BCVerifierError, BCVerifierNotFound, HashValueType,
         KeyValueBlock, KeyValuePair, KeyValuePairRead, KeyValueTransaction } from "../../common";

// Proto buffer
import { common, kvrwset, protos, rwset } from "fabric-protos";
import { getApplicationMSPs, getOrdererMSPs } from "./fabric-utils";

class VarBuffer {
    private buffer: Buffer;
    private offset: number;

    constructor(b: Buffer) {
        this.buffer = b;
        this.offset = 0;
    }

    public readVarInt(): number {
        let ret = 0;
        let i = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const value = this.buffer.readUInt8(this.offset);
            this.offset++;

            // eslint-disable-next-line no-bitwise
            ret = ret | ((value & 0x7f) << (i * 7));
            // eslint-disable-next-line no-bitwise
            if (!(value & 0x80)) {
                break;
            }
            i++;
        }
        return ret;
    }

    public readBytes(len: number): Buffer {
        const slice = this.buffer.slice(this.offset, this.offset + len);
        this.offset += len;

        return slice;
    }
}

function encodeOrderPreservingInt(num: number) {
    const enc: number[] = [];
    // First encode to bytes in little-endian
    while (num > 0) {
        // eslint-disable-next-line no-bitwise
        enc.push(num & 0xff);
        // eslint-disable-next-line no-bitwise
        num = num >> 8;
    }
    const szBuf = encodeVarInt(enc.length);
    const dataBuf = Buffer.alloc(enc.length);

    for (let i = 0; i < enc.length; i++) {
        const j = enc.length - i - 1;
        dataBuf.writeUInt8(enc[j], i);
    }
    return Buffer.concat([szBuf, dataBuf]);
}

function encodeVarInt(num: number): Buffer {
    const enc: number[] = [];

    while (num > 0) {
        // eslint-disable-next-line no-bitwise
        enc.push(num & 0x7f);
        // eslint-disable-next-line no-bitwise
        num = num >> 7;
    }
    if (enc.length === 0) {
        enc.push(0);
    }

    const buf = Buffer.alloc(enc.length);
    for (let i = 0; i < enc.length; i++) {
        const j = enc.length - i - 1;
        if (j !== 0) {
            // eslint-disable-next-line no-bitwise
            buf.writeUInt8(enc[j] | 0x80, i);
        } else {
            buf.writeUInt8(enc[j], i);
        }
    }
    return buf;
}

export enum FabricMetaDataIndex {
    SIGNATURES = 0,
    LAST_CONFIG = 1,
    TRANSACTION_FILTER = 2
}

type FabricBlockConstructorOptions = { fromFile: boolean, data: Buffer };

export interface FabricConfigTransactionInfo {
    blockNumber: number;
    ordererMSPs: MSPConfig[];
    applicationMSPs: MSPConfig[];
    transactionId: string;
}

export class FabricBlock implements KeyValueBlock {
    public static fromFileBytes(bytes: Buffer) {
        return new FabricBlock({ fromFile: true, data: bytes });
    }

    public static fromQueryBytes(bytes: Buffer) {
        return new FabricBlock({ fromFile: false, data: bytes });
    }

    private rawBytes: Buffer;
    private rawBlock: BlockData;
    private block: any;
    private transactions: FabricTransaction[];

    private constructor(opt: FabricBlockConstructorOptions) {
        this.rawBytes = opt.data;
        if (opt.fromFile) {
            const blockBuf = new VarBuffer(opt.data);

            // Header
            const headerNum = blockBuf.readVarInt();
            const headerHashLen = blockBuf.readVarInt();
            const headerHash = blockBuf.readBytes(headerHashLen);
            const headerPrevHashLen = blockBuf.readVarInt();
            const headerPrevHash = blockBuf.readBytes(headerPrevHashLen);

            // Data
            const nData = blockBuf.readVarInt();
            const data = [];

            for (let i = 0; i < nData; i++) {
                const dataLen = blockBuf.readVarInt();
                data.push(blockBuf.readBytes(dataLen));
            }

            const nMetadata = blockBuf.readVarInt();
            const metadata = [];
            for (let i = 0; i < nMetadata; i++) {
                const dataLen = blockBuf.readVarInt();
                metadata.push(blockBuf.readBytes(dataLen));
            }

            const blockObj = {
                header : { number : headerNum, previous_hash : headerPrevHash, data_hash : headerHash },
                data : { data: data },
                metadata : { metadata: metadata }
            };
            this.rawBlock = blockObj;

            this.block = BlockDecoder.decodeBlock(blockObj);
        } else {
            this.block = BlockDecoder.decode(opt.data);

            const protoBlock = common.Block.decode(opt.data);
            if (protoBlock.data == null || protoBlock.data.data == null || protoBlock.header == null
                || protoBlock.metadata == null || protoBlock.metadata.metadata == null) {
                throw new BCVerifierError("Missing mandatory field in a block");
            }
            if (protoBlock.header.number == null || protoBlock.header.previous_hash == null
                || protoBlock.header.data_hash == null) {
                throw new BCVerifierError("Missing mandatory field in a block header");
            }

            const data: Buffer[] = [];
            for (const dataProto of protoBlock.data.data) {
                data.push(Buffer.from(dataProto));
            }

            // XXX: Should use long for header.number
            const number = typeof(protoBlock.header.number) === "number" ? protoBlock.header.number
                : protoBlock.header.number.toNumber();

            this.rawBlock = {
                header : { number: number,
                           previous_hash: Buffer.from(protoBlock.header.previous_hash),
                           data_hash: Buffer.from(protoBlock.header.data_hash) },
                data : { data: data },
                metadata : { metadata: protoBlock.metadata.metadata.map((u) => Buffer.from(u)) }
            };
        }

        this.transactions = [];
        let t = 0;
        for (const tx of this.block.data.data) {
            let validity = false;
            if (this.block.metadata.metadata[FabricMetaDataIndex.TRANSACTION_FILTER][t] === 0) {
                validity = true;
            }

            this.transactions.push(new FabricTransaction(tx, this, validity, this.rawBlock.data.data[t], t));

            t++;
        }
    }

    public getRaw(): Buffer {
        return this.rawBytes;
    }

    public getBlockNumber() {
        return parseInt(this.block.header.number, 10);
    }

    public getHashValue(): Buffer {
        return Buffer.from(this.block.header.data_hash, "hex");
    }

    public getPrevHashValue(): Buffer {
        return Buffer.from(this.block.header.previous_hash, "hex");
    }

    public calcHashValue(hashType: HashValueType): Buffer {
        switch (hashType) {
            case HashValueType.HASH_FOR_PREV:
                return this.calcHeaderHash();
            case HashValueType.HASH_FOR_SELF:
                return this.calcDataHash();
        }
    }

    public getTransactions(): FabricTransaction[] {
        return this.transactions;
    }

    /* Fabric Block Spec Methods */
    public calcHeaderHash(): Buffer {
        const hash = createHash("sha256");
        hash.update(this.getHeaderBytes());

        return hash.digest();
    }

    public calcDataHash(): Buffer {
        const hash = createHash("sha256");
        hash.update(this.getDataBytes());

        return hash.digest();
    }

    public getMetaData(index: FabricMetaDataIndex): any | undefined {
        return this.block.metadata.metadata[index];
    }

    public getHeaderBytes(): Buffer {
        // Create ASN.1 structure to calculate the header hash
        const seq = new Sequence();
        seq.valueBlock.value.push(new Integer({ value: this.block.header.number }));
        const prevHash = (new Uint8Array(this.getPrevHashValue())).buffer;
        seq.valueBlock.value.push(new OctetString({ valueHex: prevHash }));
        const dataHash = (new Uint8Array(this.getHashValue())).buffer;
        seq.valueBlock.value.push(new OctetString({ valueHex: dataHash }));

        return Buffer.from(seq.toBER(false));
    }

    public getDataBytes(): Buffer {
        return Buffer.concat(this.rawBlock.data.data);
    }

    public getConfigTx(): FabricTransaction {
        if (this.transactions.length === 1 && this.transactions[0].getTransactionType() === 1) {
            return this.transactions[0];
        }
        throw new BCVerifierNotFound("Not config transaction or multiple transactions found");
    }

    public getConfigTxInfo(): FabricConfigTransactionInfo {
        const configTx = this.getConfigTx();

        return {
            applicationMSPs: getApplicationMSPs(configTx),
            blockNumber: this.getBlockNumber(),
            transactionId: configTx.getTransactionID(),
            ordererMSPs: getOrdererMSPs(configTx),
        };
    }

    public getLastConfigBlockIndex(): number {
        const lastConfig = this.getMetaData(FabricMetaDataIndex.LAST_CONFIG);
        // XXX: May cause issue in big number (> 53 bit)
        const index = lastConfig.value?.index == null ? 0 : parseInt(lastConfig.value.index, 10);

        return index;
    }

    public async addPrivateData(privateDB: any): Promise<void> {
        for (const i in this.transactions) {
            await this.transactions[i].addPrivateData(privateDB);
        }
    }

    public toString(): string {
        return format("Block(%d)", this.getBlockNumber());
    }
}

export type RawEnvelope = {
    payload: Buffer;
    signature: Buffer;
};

export type RawAction = {
    header: Buffer;
    payload: Buffer;
};

export enum FabricTransactionType {
    MESSAGE = 0,
    CONFIG = 1,
    CONFIG_UPDATE = 2,
    ENDORSER_TRANSACTION = 3,
    ORDERER_TRANSACTION = 4,
    DELIVER_SEEK_INFO = 5,
    CHAINCODE_PACKAGE = 6
}

export class FabricTransaction implements KeyValueTransaction {
    public static KEY_NS_SEPARATOR = Buffer.from([0x00]);

    public static getConfigTxName(blockNumber: number) {
        return format("config.%d", blockNumber);
    }

    public signature: Buffer;
    public header: any;
    public data: any;
    public block: FabricBlock;
    public validity: boolean;
    public rawData: Buffer;
    public rawTransaction: RawEnvelope;
    public index: number;
    public actions: FabricAction[];

    constructor(blockData: any, block: FabricBlock, validity: boolean, rawData: Buffer, index: number) {
        this.signature = blockData.signature;
        this.header = blockData.payload.header;
        this.data = blockData.payload.data;
        this.block = block;
        this.validity = validity;
        this.rawData = rawData;
        this.rawTransaction = this.getRawEnvelope();
        this.index = index;

        // Decode actions
        this.actions = [];

        if (this.getTransactionType() === FabricTransactionType.ENDORSER_TRANSACTION) {
            const payload = common.Payload.decode(this.getPayloadBytes());
            const transaction = protos.Transaction.decode(payload.data);

            for (const i in transaction.actions) {
                const action = transaction.actions[i];
                if (action.header == null || action.payload == null) {
                    throw new BCVerifierError("Missing mandatory fields in an action");
                }
                const rawAction = {
                    header: Buffer.from(action.header),
                    payload: Buffer.from(action.payload)
                };

                this.actions.push(new FabricAction(this, rawAction,
                                                   this.data.actions[i], parseInt(i, 10)));
            }
        }
    }

    public getTransactionID(): string {
        if (this.getTransactionType() === FabricTransactionType.CONFIG) {
            // As a config transaction does not have tx_id and it should be only transaction in a block,
            // use block number instead.
            return FabricTransaction.getConfigTxName(this.block.getBlockNumber());
        } else {
            return this.header.channel_header.tx_id;
        }
    }

    public getTransactionType(): number {
        return this.header.channel_header.type;
    }

    public getBlock(): FabricBlock {
        return this.block;
    }

    public getIndexInBlock(): number {
        return this.index;
    }

    public getPayloadBytes(): Buffer {
        return this.rawTransaction.payload;
    }

    public getTransactionTypeString(): string {
        return common.HeaderType[this.getTransactionType()];
    }

    public getRawEnvelope(): RawEnvelope {
        const envelope = common.Envelope.decode(this.rawData);
        return {
            payload: Buffer.from(envelope.payload),
            signature: Buffer.from(envelope.signature)
        };
    }

    public getActions(): FabricAction[] {
        return this.actions;
    }

    public getChannelName(): string {
        return this.header.channel_header.channel_id;
    }

    public async addPrivateData(privateDB: any): Promise<void> {
        if (this.getTransactionType() === FabricTransactionType.ENDORSER_TRANSACTION) {
            const channelName = this.getChannelName();
            for (const action of this.actions) {
                await action.addPrivateData(channelName, privateDB);
            }
        }
    }

    public toString(): string {
        if (this.getTransactionType() === FabricTransactionType.CONFIG) {
            return format("%s.ConfigTx", this.block.toString());
        } else {
            return format("%s.Tx(%d:%d)", this.block.toString(), this.block.getBlockNumber(), this.index);
        }
    }

    public getReadSet(): KeyValuePairRead[] {
        const result: KeyValuePairRead[] = [];
        if (this.getTransactionType() !== FabricTransactionType.ENDORSER_TRANSACTION) {
            return result;
        }
        if (this.validity === false) {
            return result;
        }

        for (const action of this.actions) {
            const rws = action.getRWSets();
            for (const rw of rws) {
                const nsBuffer = Buffer.from(rw.namespace);
                for (const read of rw.rwset.reads) {
                    const key = Buffer.concat([
                        nsBuffer, FabricTransaction.KEY_NS_SEPARATOR, Buffer.from(read.key)
                    ]);
                    if (read.version == null) {
                        // TODO: Read key has null version
                    } else {
                        const version = Buffer.from(read.version.block_num + "-" + read.version.tx_num);
                        result.push({
                            key: key,
                            version: version
                        });
                    }
                }
            }
        }

        return result;
    }

    public getWriteSet(): KeyValuePair[] {
        const result: KeyValuePair[] = [];
        if (this.getTransactionType() !== FabricTransactionType.ENDORSER_TRANSACTION) {
            return result;
        }
        if (this.validity === false) {
            return result;
        }

        for (const action of this.actions) {
            const rws = action.getRWSets();
            for (const rw of rws) {
                const nsBuffer = Buffer.from(rw.namespace);
                for (const write of rw.rwset.writes) {
                    const key = Buffer.concat([
                        nsBuffer, FabricTransaction.KEY_NS_SEPARATOR, Buffer.from(write.key)
                    ]);
                    const value = Buffer.from(write.value);
                    const version = Buffer.from(this.block.getBlockNumber() + "-" + this.getIndexInBlock());

                    if (write.is_delete) {
                        result.push({
                            key: key,
                            version: version,
                            isDelete: true
                        });
                    } else {
                        result.push({
                            key: key,
                            value: value,
                            version: version,
                            isDelete: false
                        });
                    }
                }
            }
        }
        return result;
    }
}

export interface FabricFunctionInfo {
    ccName: string;
    funcName: Buffer;
    args: Buffer[];
}

export class FabricAction {
    public raw: RawAction;
    public decoded: any;
    public rawPayload: protos.ChaincodeActionPayload;
    public index: number;
    public transaction: FabricTransaction;

    constructor(transaction: FabricTransaction, raw: RawAction, decoded: any, index: number) {
        this.raw = raw;
        this.decoded = decoded;
        this.index = index;
        this.transaction = transaction;

        this.rawPayload = protos.ChaincodeActionPayload.decode(this.raw.payload);
    }

    public getProposalBytes(): Buffer {
        return Buffer.from(this.rawPayload.chaincode_proposal_payload);
    }

    public getResponseBytes(): Buffer {
        if (this.rawPayload.action == null || this.rawPayload.action.proposal_response_payload == null) {
            throw new BCVerifierError("Response is missing in an action payload");
        }

        return Buffer.from(this.rawPayload.action.proposal_response_payload);
    }

    public getEndorsersBytes(): Buffer[] {
        if (this.rawPayload.action == null || this.rawPayload.action.endorsements == null) {
            throw new BCVerifierError("Endorsement is missing in an action payload");
        }

        const endorsers: Buffer[] = [];

        for (const endorsement of this.rawPayload.action.endorsements) {
            if (endorsement.endorser == null) {
                throw new BCVerifierError("Endorser is missing in an endorsement");
            }
            endorsers.push(Buffer.from(endorsement.endorser));
        }
        return endorsers;
    }

    public getHeader(): any {
        return this.decoded.header;
    }

    public getProposal(): any {
        return this.decoded.payload.chaincode_proposal_payload;
    }

    public getResponsePayload(): any {
        return this.decoded.payload.action.proposal_response_payload;
    }

    public getEndorsements(): any[] {
        return this.decoded.payload.action.endorsements;
    }

    public getRWSets(): any {
        const payload = this.getResponsePayload();
        return payload.extension.results.ns_rwset;
    }

    public getFunction(): FabricFunctionInfo | null {
        const proposal = this.getProposal();
        const args = proposal.input.chaincode_spec.input.args;
        if (args == null || args.length <= 0) {
            return null;
        }
        const ccid = proposal.input.chaincode_spec.chaincode_id;

        return {
            ccName: ccid.name,
            funcName: args[0],
            args: args.slice(1)
        };
    }

    public async addPrivateData(channelName: string, privateDB: any) {
        const rwsets = this.getRWSets();

        for (const set of rwsets) {
            if (set.collection_hashed_rwset != null) {
                const namespace = set.namespace;
                const privateRWSets: Array<FabricPrivateRWSet | null> = [];
                for (const hashedRWSet of set.collection_hashed_rwset) {
                    const collection = hashedRWSet.collection_name;
                    const privateRWSet =
                        await FabricPrivateRWSet.queryPrivateStore(privateDB, channelName, this.transaction,
                                                                   namespace, collection);
                    privateRWSets.push(privateRWSet);
                }
                set.private_rwset = privateRWSets;
            }
        }
    }

    public toString(): string {
        return format("%s.Action[%d]", this.transaction.toString(), this.index);
    }
}

export class FabricPrivateRWSet {
    public static PRIVATE_DATA_PREFIX = Buffer.from([0x02]);

    public static KEY_SEPARATOR = Buffer.from([0x00]);

    public static async queryPrivateStore(privateDB: any, channelName: string, transaction: FabricTransaction,
                                          namespace: string, collection: string): Promise<FabricPrivateRWSet | null> {
        const blockNumber = transaction.getBlock().getBlockNumber();
        const txNumber = transaction.getIndexInBlock();
        const queryKey = this.buildKey(channelName, blockNumber, txNumber,
                                       namespace, collection);
        try {
            const data = await privateDB.get(queryKey);

            const name = format("%d:%d,%s,%s", blockNumber, txNumber, namespace, collection);
            return new FabricPrivateRWSet(data, name);
        } catch (e) {
            return null;
        }
    }

    public static buildKey(channelName: string, blockNumber: number, txNumber: number,
                           namespace: string, collection: string): Buffer {
        const blockNumberEncoded = encodeOrderPreservingInt(blockNumber);
        const txNumberEncoded = encodeOrderPreservingInt(txNumber);

        return Buffer.concat([
            Buffer.from(channelName, "utf-8"),
            this.KEY_SEPARATOR,
            this.PRIVATE_DATA_PREFIX,
            blockNumberEncoded,
            txNumberEncoded,
            Buffer.from(namespace, "utf-8"),
            this.KEY_SEPARATOR,
            Buffer.from(collection, "utf-8")
        ]);
    }

    public static calcHash(data: Buffer): Buffer {
        const hash = createHash("sha256");
        hash.update(data);

        return hash.digest();
    }

    private rawBytes: Buffer;
    private rwSetBytes: Buffer;
    private decoded: any;
    private name: string;

    constructor(data: Buffer, name: string) {
        this.rawBytes = data;

        const protoCol = rwset.CollectionPvtReadWriteSet.decode(this.rawBytes);
        this.rwSetBytes = Buffer.from(protoCol.rwset);

        this.decoded = {
            collection_name: protoCol.collection_name,
            rwset: kvrwset.KVRWSet.decode(this.rwSetBytes)
        };

        this.name = name;
    }

    public getRWSet() {
        return this.decoded;
    }

    public getRWSetBytes() {
        return this.rwSetBytes;
    }

    public toString() {
        return format("FabricPrivateDB(%s)", this.name);
    }
}
