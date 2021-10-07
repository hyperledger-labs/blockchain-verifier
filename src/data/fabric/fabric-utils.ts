/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createVerify } from "crypto";
import { common, msp } from "fabric-protos";
import { verifySigningChain } from "pem";
import { BCVerifierError, BCVerifierNotFound } from "../../common";
import { BlockProvider } from "../../provider";
import { FabricBCVCheckpoint } from "./fabric-bcv-checkpoint";
import { FabricBlock, FabricConfigTransactionInfo, FabricTransaction } from "./fabric-data";
import { FabricOUIdentifier, MSPConfig, SigningIdentityInfo } from "./fabric-types";

export function getOrdererMSPs(configTx: FabricTransaction): MSPConfig[] {
    const groups = configTx.data.config.channel_group.groups.Orderer.groups;
    const results: MSPConfig[] = [];

    for (const org in groups) {
        const group = groups[org];
        const mspConfig: MSPConfig = group.values.MSP.value.config;

        results.push(mspConfig);
    }

    return results;
}

export function getApplicationMSPs(configTx: FabricTransaction): MSPConfig[] {
    const groups = configTx.data.config.channel_group.groups.Application.groups;
    const results: MSPConfig[] = [];

    for (const org in groups) {
        const group = groups[org];
        const mspConfig: MSPConfig = group.values.MSP.value.config;

        results.push(mspConfig);
    }

    return results;
}

export function findMSP(mspName: string, mspConfigs: MSPConfig[]): MSPConfig {
    for (const config of mspConfigs) {
        if (config.name === mspName) {
            return config;
        }
    }
    throw new BCVerifierNotFound();
}

export function verifyIdentityMSP(mspName: string, identity: string, mspConfigs: MSPConfig[]): Promise<boolean> {
    try {
        const config = findMSP(mspName, mspConfigs);
        return new Promise((resolve, reject) => {
            verifySigningChain(identity, config.root_certs.map((cert) => cert.toString("utf-8")), (error, result) => {
                if (error != null) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    } catch (e) {
        if (e instanceof BCVerifierNotFound) {
            return Promise.resolve(false);
        }
        return Promise.reject(e);
    }
}

export async function verifySignatureHeader(signatureHeader: any, mspConfigs: MSPConfig[]): Promise<boolean> {
    return await verifyIdentityMSP(signatureHeader.creator.mspid, signatureHeader.creator.id_bytes, mspConfigs);
}

export function verifySignature(signature: Buffer, data: Buffer, identity: any): boolean {
    // algorithm needs to conform to config.
    const verify = createVerify("sha256");

    verify.update(data);

    return verify.verify(identity.id_bytes, signature);
}

export function verifyMetadataSignature(block: FabricBlock, data: Buffer, metadataSignature: any): boolean {
    const verify = createVerify("sha256");

    const creator = msp.SerializedIdentity.encode({
        mspid: metadataSignature.signature_header.creator.mspid,
        id_bytes: Buffer.from(metadataSignature.signature_header.creator.id_bytes)
    }).finish();

    const sigHeader = common.SignatureHeader.encode({
        creator: creator,
        nonce: metadataSignature.signature_header.nonce
    }).finish();

    verify.update(Buffer.concat([data, sigHeader, block.getHeaderBytes()]));

    return verify.verify(metadataSignature.signature_header.creator.id_bytes, metadataSignature.signature);
}

export class FabricConfigCache {
    protected static instance: FabricConfigCache | null = null;

    private configMap: { [configBlockNumber: number]: FabricConfigTransactionInfo };
    private provider: BlockProvider;

    public static Init(provider: BlockProvider, checkpoint?: FabricBCVCheckpoint) {
        if (FabricConfigCache.instance == null) {
            FabricConfigCache.instance = new FabricConfigCache(provider, checkpoint);
        }
        return FabricConfigCache.instance;
    }

    public static GetInstance() {
        if (FabricConfigCache.instance == null) {
            throw new Error("No FabricConfigCache is initialized");
        }
        return FabricConfigCache.instance;
    }

    protected constructor(provider: BlockProvider, checkpoint?: FabricBCVCheckpoint) {
        this.configMap = {};
        this.provider = provider;

        if (checkpoint != null) {
            const info = checkpoint.getLastConfigBlockInfo();
            this.configMap[info.blockNumber] = info;
        }
    }

    public async getConfig(blockNumber: number): Promise<FabricConfigTransactionInfo> {
        if (this.configMap[blockNumber] == null) {
            const configBlock = await this.provider.getBlock(blockNumber);

            if (!(configBlock instanceof FabricBlock)) {
                throw new BCVerifierError("Provider does not return FabricBlock");
            }
            this.configMap[blockNumber] = configBlock.getConfigTxInfo();
        }
        return this.configMap[blockNumber];
    }
}

function serializeOUIdentifier(ouIdentifier: FabricOUIdentifier) {
    return {
        certificate: ouIdentifier.certificate.toString("base64"),
        organizational_unit_identifier: ouIdentifier.organizational_unit_identifier
    };
}
function deserializeOUIdentifier(ouIdentifier: any): FabricOUIdentifier {
    return {
        certificate: Buffer.from(ouIdentifier.certificate, "base64"),
        organizational_unit_identifier: ouIdentifier.organizational_unit_identifier
    };
}

function serializeSigningIdentity(signingIdentity: SigningIdentityInfo) {
    if (signingIdentity.public_signer == null || signingIdentity.private_signer == null) {
        return {};
    } else {
        return {
            public_signer: signingIdentity.public_signer.map((cert) => cert.toString("base64")),
            private_signer: {
                key_identifier: signingIdentity.private_signer.key_identifier,
                key_material: signingIdentity.private_signer.key_material.toString("base64")
            }
        };
    }
}

function deserializeSigningIdentity(signingIdentity: any): any {
    if (signingIdentity.public_signer == null || signingIdentity.private_signer == null) {
        return {};
    } else {
        return {
            public_signer: signingIdentity.public_signer.map((cert: string) => Buffer.from(cert, "base64")),
            private_signer: {
                key_identifier: signingIdentity.private_signer.key_identifier,
                key_material: Buffer.from(signingIdentity.private_signer.key_material, "base64")
            }
        };
    }
}

function serializeMSP(msp: MSPConfig) {
    return {
        name: msp.name,
        root_certs: msp.root_certs.map((cert) => cert.toString("base64")),
        intermediate_certs: msp.intermediate_certs.map((cert) => cert.toString("base64")),
        admins: msp.admins.map((cert) => cert.toString("base64")),
        revocation_list: msp.revocation_list.map((cert) => cert.toString("base64")),
        signing_identity: serializeSigningIdentity(msp.signing_identity),
        organizational_unit_identifiers: msp.organizational_unit_identifiers.map((ouIdentifier) => serializeOUIdentifier(ouIdentifier)),
        tls_root_certs: msp.tls_root_certs.map((cert) => cert.toString("base64")),
        tls_intermediate_certs: msp.tls_intermediate_certs.map((cert) => cert.toString("base64"))
    };
}

function deserializeMSP(msp: any): MSPConfig {
    return {
        name: msp.name,
        root_certs: msp.root_certs.map((cert: string) => Buffer.from(cert, "base64")),
        intermediate_certs: msp.intermediate_certs.map((cert: string) => Buffer.from(cert, "base64")),
        admins: msp.admins.map((cert: string) => Buffer.from(cert, "base64")),
        revocation_list: msp.revocation_list.map((cert: string) => Buffer.from(cert, "base64")),
        signing_identity: deserializeSigningIdentity(msp.signing_identity),
        organizational_unit_identifiers: msp.organizational_unit_identifiers.map((ou: string) => deserializeOUIdentifier(ou)),
        tls_root_certs: msp.tls_root_certs.map((cert: string) => Buffer.from(cert, "base64")),
        tls_intermediate_certs: msp.tls_intermediate_certs.map((cert: string) => Buffer.from(cert, "base64")),
    };
}

export function serializeConfigTxInfo(info: FabricConfigTransactionInfo): any {
    return {
        applicationMSPs: info.applicationMSPs.map((msp) => serializeMSP(msp)),
        blockNumber: info.blockNumber,
        transactionId: info.transactionId,
        ordererMSPs: info.ordererMSPs.map((msp) => serializeMSP(msp))
    };
}

export function deserializeConfigTxInfo(obj: any): FabricConfigTransactionInfo {
    return {
        applicationMSPs: obj.applicationMSPs.map((msp: any) => deserializeMSP(msp)),
        blockNumber: obj.blockNumber,
        transactionId: obj.transactionId,
        ordererMSPs: obj.ordererMSPs.map((msp: any) => deserializeMSP(msp))
    };
}
