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

export type MSPConfig = {
    name: string;
    root_certs: string[];
    intermediate_certs: string[];
    admins: string[];
    revocation_list: string[];
    signing_identity: SigningIdentityInfo;
    organizational_unit_identifiers: FabricOUIdentifier;
    crypto_config: FabricCryptoConfig;
    tls_root_certs: string[];
    tls_intermediate_certs: string[];
    fabric_node_ous: FabricNodeOUs;
};
