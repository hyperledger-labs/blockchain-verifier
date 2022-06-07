/**
 * Copyright 2021 Hitachi, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricBlock, FabricConfigCache, FabricConfigTransactionInfo, FabricTransaction, MSPConfig } from ".";
import { BCVerifierNotFound } from "../../common";
import { BlockProvider } from "../../provider";
import { FabricBCVCheckpoint } from "./fabric-bcv-checkpoint";
import * as utils from "./fabric-utils";

const configTx: FabricTransaction = {
    data: {
        config: {
            channel_group: {
                groups: {
                    Orderer: {
                        groups: {
                            OrdererOrg: {
                                values: {
                                    MSP: {
                                        value: {
                                            config: {
                                                name: "OrdererOrg",
                                                root_certs: []
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    Application: {
                        groups: {
                            Org1: {
                                values: {
                                    MSP: {
                                        value: {
                                            config: {
                                                name: "Org1",
                                                root_certs: []
                                            }
                                        }
                                    }
                                }
                            },
                            Org2MSP: {
                                values: {
                                    MSP: {
                                        value: {
                                            config: {
                                                name: "Org2MSP",
                                                root_certs: []
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} as any;

describe("getOrdererMSPs", () => {
    test("Returns an array of MSPs", () => {
        const result = utils.getOrdererMSPs(configTx);

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty("name", "OrdererOrg");
    });
});

describe("getApplicationMSPs", () => {
    test("Returns an array of MSPs", () => {
        const result = utils.getApplicationMSPs(configTx);

        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty("name", "Org1");
        expect(result[1]).toHaveProperty("name", "Org2MSP");
    });
});

describe("findMSPs", () => {
    const msps = utils.getApplicationMSPs(configTx);

    test("Returns a MSP when it is found", () => {
        const config = utils.findMSP("Org1", msps);

        expect(config).toBeDefined();
        expect(config).toHaveProperty("name", "Org1");
    });

    test("Throws a BCVerifierNotFound exception when a name is not found", () => {
        expect(() => utils.findMSP("Org4", msps)).toThrowError(BCVerifierNotFound);
    });
});

describe("FabricConfigCache", () => {
    const mockBlock: FabricBlock = Object.create(FabricBlock.prototype);
    const mockConfigBlock = Object.assign(mockBlock, {
        getConfigTxInfo: jest.fn().mockReturnValue({
            blockNumber: 15
        })
    });

    const mockProvider: BlockProvider = {
        getBlock: jest.fn().mockResolvedValue(mockConfigBlock)
    } as any;

    const mockCheckpoint: FabricBCVCheckpoint = {
        getLastConfigBlockInfo: jest.fn().mockReturnValue({
            blockNumber: 10
        })
    } as any;

    test("GetInstance() throws null for a first call", () => {
        expect(() => utils.FabricConfigCache.GetInstance()).toThrowError();
    });

    test("Init() returns an instance", () => {
        const cache = utils.FabricConfigCache.Init(mockProvider, mockCheckpoint);

        expect(cache).toBeInstanceOf(FabricConfigCache);
    });

    test("GetInstance() now returns an instance after Init()", () => {
        const cache = utils.FabricConfigCache.GetInstance();

        expect(cache).toBeInstanceOf(FabricConfigCache);
    });

    test("Two Init()'s return the same instance", () => {
        const cache1 = utils.FabricConfigCache.Init(mockProvider, mockCheckpoint);
        const cache2 = utils.FabricConfigCache.Init(mockProvider, mockCheckpoint);

        expect(cache1).toBe(cache2);
    });

    test("getConfig() returns a config block information for Block 15", async () => {
        const cache = utils.FabricConfigCache.GetInstance();

        const info = await cache.getConfig(15);
        expect(info).toHaveProperty("blockNumber", 15);
        expect(mockProvider.getBlock).toHaveBeenCalled();
        expect(mockProvider.getBlock).toHaveBeenCalledWith(15);
    });

    test("getConfig() returns a config block information for Block 10 without getting the block", async () => {
        const cache = utils.FabricConfigCache.GetInstance();
        (mockProvider.getBlock as jest.Mock).mockClear();

        const info = await cache.getConfig(10);
        expect(info).toHaveProperty("blockNumber", 10);
        expect(mockProvider.getBlock).not.toHaveBeenCalled();
    });
});

const mspConfig: MSPConfig = {
    name: "Org3MSP",
    root_certs: [
        Buffer.from("Org3 Root Certificate")
    ],
    intermediate_certs: [
        Buffer.from("Org3 Intermediate Certificate")
    ],
    admins: [
        Buffer.from("Org3 Admin Certificate")
    ],
    revocation_list: [
        Buffer.from("Org3 Revocation 1"),
        Buffer.from("Org3 Revocation 2")
    ],
    signing_identity: {
        public_signer: [
            Buffer.from("Public Signer")
        ],
        private_signer: {
            key_identifier: "Key ID",
            key_material: Buffer.from("Private Key")
        }
    },
    organizational_unit_identifiers: [{
        certificate: Buffer.from("OU Certificate"),
        organizational_unit_identifier: "OU ID"
    }],
    tls_root_certs: [
        Buffer.from("Org3 TLS Root Certificate")
    ],
    tls_intermediate_certs: [
        Buffer.from("Org3 TLS Intermediate Certificate")
    ]
};

const txInfo: FabricConfigTransactionInfo = {
    applicationMSPs: [mspConfig],
    blockNumber: 42,
    transactionId: "ConfigTx42",
    ordererMSPs: [mspConfig]
};

describe("serializeConfigTxInfo()", () => {
    test("returns serialized object", () => {
        const obj = utils.serializeConfigTxInfo(txInfo);

        expect(obj).toHaveProperty("blockNumber", 42);
        expect(obj).toHaveProperty("transactionId", "ConfigTx42");
        expect(obj.applicationMSPs).toHaveLength(1);
        expect(obj.applicationMSPs[0]).toHaveProperty("name", "Org3MSP");
        const app = obj.applicationMSPs[0];
        expect(app.root_certs[0]).toBe(mspConfig.root_certs[0].toString("base64"));
        expect(app.intermediate_certs[0]).toBe(mspConfig.intermediate_certs[0].toString("base64"));
    });
});

describe("deserializeConfigTxInfo()", () => {
    test("returns ConfigTxInfo from serialized one", () => {
        const obj = utils.serializeConfigTxInfo(txInfo);
        const deserializedTxInfo = utils.deserializeConfigTxInfo(obj);

        expect(deserializedTxInfo).toStrictEqual(txInfo);
    });
});
