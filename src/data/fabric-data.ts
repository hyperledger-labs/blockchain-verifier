/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Integer, OctetString, Sequence } from "asn1js";
import { createHash } from "crypto";
import { BlockData, decodeBlock, HeaderType } from "fabric-client/lib/BlockDecoder";
import * as grpc from "grpc";
import * as path from "path";
import { format } from "util";

import { BCVerifierNotFound, Block, HashValueType, Transaction } from "../common";

// Proto buffer
export const Protos = {
    common: grpc.load<any>(path.join(__dirname,
                                     "../../node_modules/fabric-client/lib/protos/common/common.proto")).common,
    identities: grpc.load<any>(path.join(__dirname,
                                         "../../node_modules/fabric-client/lib/protos/msp/identities.proto")).msp,
    proposal: grpc.load<any>(path.join(__dirname,
                                       "../../node_modules/fabric-client/lib/protos/peer/proposal.proto")).protos,
    transaction: grpc.load<any>(path.join(__dirname,
                                          "../../node_modules/fabric-client/lib/protos/peer/transaction.proto")).protos
};

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

        while (true) {
            const value = this.buffer.readUInt8(this.offset);
            this.offset++;

            // tslint:disable-next-line: no-bitwise
            ret = ret | ((value & 0x7f) << (i * 7));
            // tslint:disable-next-line: no-bitwise
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

export enum FabricMetaDataIndex {
    SIGNATURES = 0,
    LAST_CONFIG = 1,
    TRANSACTION_FILTER = 2
}

type FabricBlockConstructorOptions = { encoded: true, data: Buffer };

export class FabricBlock implements Block {
    public static fromBytes(bytes: Buffer) {
        return new FabricBlock({ encoded: true, data: bytes });
    }

    private rawBytes: Buffer;
    private rawBlock: BlockData;
    private block: any;
    private transactions: FabricTransaction[];

    private constructor(opt: FabricBlockConstructorOptions) {
        this.rawBytes = opt.data;
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

        this.block = decodeBlock(blockObj);

        this.transactions = [];
        let t = 0;
        for (const tx of this.block.data.data) {
            let validity = false;
            if (this.block.metadata.metadata[FabricMetaDataIndex.TRANSACTION_FILTER][t]) {
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

export class FabricTransaction implements Transaction {
    public signature: Buffer;
    public header: any;
    public data: any;

    public block: FabricBlock;
    public validity: boolean;
    public rawData: Buffer;
    public rawTransaction: RawEnvelope;
    public index: number;

    constructor(blockData: any, block: FabricBlock, validity: boolean, rawData: Buffer, index: number) {
        this.signature = blockData.signature;
        this.header = blockData.payload.header;
        this.data = blockData.payload.data;
        this.block = block;
        this.validity = validity;
        this.rawData = rawData;
        this.rawTransaction = this.getRawEnvelope();
        this.index = index;
    }

    public getTransactionID(): string {
        if (this.getTransactionType() === 1) {
            // As a config transaction does not have tx_id, use block number instead.
            return format("config.%d", this.block.getBlockNumber());
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
        return HeaderType.convertToString(this.getTransactionType());
    }

    public getRawEnvelope(): RawEnvelope {
        const envelope = Protos.common.Envelope.decode(this.rawData);

        return {
            payload: envelope.getPayload().toBuffer(),
            signature: envelope.getSignature().toBuffer()
        };
    }

    public getActions(): FabricAction[] {
        const payload = Protos.common.Payload.decode(this.getPayloadBytes());
        const payloadData = payload.getData().toBuffer();
        const transaction = Protos.transaction.Transaction.decode(payloadData);
        const actions: FabricAction[] = [];

        for (const i in transaction.actions) {
            actions.push(new FabricAction(this, transaction.actions[i], this.data.actions[i], parseInt(i, 10)));
        }
        return actions;
    }

    public toString(): string {
        if (this.getTransactionType() === 1) {
            return format("%s.ConfigTx", this.block.toString());
        } else {
            return format("%s.Tx(%d:%d)", this.block.toString(), this.block.getBlockNumber(), this.index);
        }
    }
}

export class FabricAction {
    public raw: RawAction;
    public decoded: any;
    public rawPayload: any;
    public index: number;
    public transaction: FabricTransaction;

    constructor(transaction: FabricTransaction, raw: RawAction, decoded: any, index: number) {
        this.raw = raw;
        this.decoded = decoded;
        this.index = index;
        this.transaction = transaction;

        this.rawPayload = Protos.transaction.ChaincodeActionPayload.decode(this.raw.payload);
    }

    public getProposalBytes(): Buffer {
        return this.rawPayload.getChaincodeProposalPayload().toBuffer();
    }
    public getResponseBytes(): Buffer {
        return this.rawPayload.getAction().proposal_response_payload.toBuffer();
    }
    public getEndorsersBytes(): Buffer[] {
        const endorsers: Buffer[] = [];
        for (const endorsement of this.rawPayload.getAction().endorsements) {
            endorsers.push(endorsement.endorser.toBuffer());
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

    public toString(): string {
        return format("%s.Action[%d]", this.transaction.toString(), this.index);
    }
}
