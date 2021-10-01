/*
 * Copyright 2019 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export type BlockData = {
    header: {
        number: number;
        previous_hash: Buffer;
        data_hash: Buffer;
    };
    data: {
        data: Buffer[];
    };
    metadata: {
        metadata: Buffer[];
    };
};

export type KeyInfo = {
    key_identifier: string;
    key_material: Buffer;
};

export type SigningIdentityInfo = {
    public_signer: Buffer[];
    private_signer: KeyInfo;
};

export type FabricOUIdentifier = {
    certificate: Buffer;
    organizational_unit_identifier: string;
};

export type FabricNodeOUs = {
    enable: boolean;
    client_ou_identifier: FabricOUIdentifier;
    peer_ou_identifier: FabricOUIdentifier;
};

export type FabricCryptoConfig = {
    signature_hash_family: string;
    identity_identifier_hash_function: string;
};

// crypto_config and fabric_node_ous are missing in decodeFabricMSPConfig() in fabric-common/lib/BlockDecoder.js
export type MSPConfig = {
    name: string;
    root_certs: Buffer[];
    intermediate_certs: Buffer[];
    admins: Buffer[];
    revocation_list: Buffer[];
    signing_identity: SigningIdentityInfo;
    organizational_unit_identifiers: FabricOUIdentifier[];
    tls_root_certs: Buffer[];
    tls_intermediate_certs: Buffer[];
};
