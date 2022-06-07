/*
 * Copyright 2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { Channel, Client, Endorser, Endpoint, IdentityContext, Query, User } from "fabric-common";
import { common } from "fabric-protos";
import fs from "fs";
import path from "path";
import { BCVerifierError } from "../common";
import { FabricBlock } from "../data/fabric";
import { DataModelType } from "../network-plugin";
import FabricQuery2Plugin, { FabricQuery2PluginConfig, FabricQuery2Source } from "./fabric-query2";

jest.mock("fabric-common");
jest.mock("../data/fabric");

const testDataDir = path.join(__dirname, "..", "..", "test", "fabric-query2");
const configFile = path.join(testDataDir, "config.json");
const configMultiplePeersFile = path.join(testDataDir, "config.multiple.json");
const configNoPeerFile = path.join(testDataDir, "config.none.json");

// Dummy objects
const queryObj = new Query("cc", new Channel("ch", new Client("client")));
const endorserObj = new Endorser("cc", new Client("client"), "msp");

const channelObj = new Channel("ch", new Client("client"));
const identityContextObj = new IdentityContext(new User("a"), new Client("client"));

(channelObj.newQuery as jest.Mock).mockImplementation(() => queryObj);
const newChannel = jest.fn().mockImplementation(() => channelObj);
const newEndpoint = jest.fn().mockImplementation(() => new Endpoint({}));
(Client.newClient as jest.Mock).mockImplementation(() => ({
    newChannel: newChannel,
    newIdentityContext: jest.fn().mockImplementation(() => identityContextObj),
    newEndorser: () => endorserObj,
    newEndpoint: newEndpoint
}));

describe("FabricQuery2Source", () => {
    const config: FabricQuery2PluginConfig = JSON.parse(fs.readFileSync(configFile).toString());
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const peerConfig = config.peer!;

    describe("constructor", () => {
        test("creates a FabricQuery2Source instance", () => {
            (Client.newClient as jest.Mock).mockClear();
            (newChannel as jest.Mock).mockClear();
            (channelObj.newQuery as jest.Mock).mockClear();
            (User.createUser as jest.Mock).mockClear();

            const _source = new FabricQuery2Source(config, peerConfig);

            expect(Client.newClient).toBeCalledTimes(1);
            expect(newChannel).toBeCalledTimes(1);
            expect(newChannel).toBeCalledWith("test-channel");
            expect(channelObj.newQuery).toBeCalledTimes(1);
            expect(channelObj.newQuery).toBeCalledWith("qscc");
            expect(User.createUser).toBeCalledTimes(1);
            expect(User.createUser).toBeCalledWith("user", "", "user-org", "user-cert.pem", "user-key.pem");
        });
    });
    describe("init()", () => {
        test("initializes a connection to peer", async () => {
            const source = new FabricQuery2Source(config, peerConfig);

            (newEndpoint as jest.Mock).mockClear();
            (endorserObj.connect as jest.Mock).mockClear();

            await source.init();

            expect(newEndpoint).toBeCalledWith({
                url: "grpcs://localhost:7051",
                pem: "org1-ca-tls.pem",
                clientCert: "tls-user-cert.pem",
                clientKey: "tls-user-key.pem"
            });
            expect(endorserObj.connect).toBeCalledTimes(1);
        });
    });
    describe("getSourceID()", () => {
        test("returns the URL as the source ID", () => {
            const source = new FabricQuery2Source(config, peerConfig);

            expect(source.getSourceID()).toBe("grpcs://localhost:7051");
        });
    });
    describe("getSourceOrganizationID()", () => {
        test("returns the MSP ID as the organization ID", () => {
            const source = new FabricQuery2Source(config, peerConfig);

            expect(source.getSourceOrganizationID()).toBe("org1");
        });
    });
    describe("getBlock()", () => {
        test("returns a block", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.build as jest.Mock).mockClear();
            (queryObj.sign as jest.Mock).mockClear();
            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => ({
                queryResults: [
                    Buffer.from("This is a block 1")
                ]
            }));
            (FabricBlock.fromQueryBytes as jest.Mock).mockClear().mockImplementation(() => ({
                blockNumber: 1
            }));

            const block = await source.getBlock(1);

            expect(queryObj.build).toBeCalledWith(identityContextObj, {
                fcn: "GetBlockByNumber",
                args: ["test-channel", "1"]
            });
            expect(queryObj.sign).toBeCalledWith(identityContextObj);
            expect(FabricBlock.fromQueryBytes).toBeCalledWith(Buffer.from("This is a block 1"));
            expect(block).toStrictEqual({ blockNumber: 1 });
        });

        test("throws an error when init was not called", async () => {
            const source = new FabricQuery2Source(config, peerConfig);

            await expect(source.getBlock(1)).rejects.toThrowError(BCVerifierError);
        });

        test("throws an error when qscc returns an error", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => ({
                queryResults: [],
                responses: [{
                    response: {
                        status: 500,
                        message: "Block out of range"
                    }
                }]
            }));

            await expect(source.getBlock(1000)).rejects.toThrowError(BCVerifierError);
        });
    });
    describe("getBlockHash()", () => {
        test("returns a hash", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => ({
                queryResults: [
                    Buffer.from("This is some block")
                ]
            }));
            (FabricBlock.fromQueryBytes as jest.Mock).mockClear().mockImplementation(() => ({
                blockNumber: 2,
                getHashValue: () => Buffer.from("ABCD")
            }));

            const hash = await source.getBlockHash(2);
            expect(hash.toString()).toBe("ABCD");
        });
    });
    describe("getBlockRange()", () => {
        test("returns blocks", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => (
                {
                    queryResults: [
                        Buffer.from("This is some block")
                    ]
                }));

            let i = 3;
            (FabricBlock.fromQueryBytes as jest.Mock).mockClear().mockImplementation(() => ({
                blockNumber: i++,
                getBlockNumber: function() {
                    return this.blockNumber;
                }
            }));

            const blocks = await source.getBlockRange(3, 7);

            expect(blocks).toHaveLength(5);
            expect(blocks[0].getBlockNumber()).toBe(3);
            expect(blocks[2].getBlockNumber()).toBe(5);
            expect(blocks[4].getBlockNumber()).toBe(7);
        });

        test("throws when the range is invalid", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            await expect(source.getBlockRange(4, 3)).rejects.toThrowError(BCVerifierError);
        });
    });
    describe("getBlockHeight()", () => {
        test("returns the height of blocks", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.build as jest.Mock).mockClear();
            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => (
                {
                    queryResults: [
                        common.BlockchainInfo.encode({
                            height: 120
                        }).finish()
                    ]
                }));

            await expect(source.getBlockHeight()).resolves.toBe(120);

            expect(queryObj.build).toBeCalledWith(identityContextObj, {
                fcn: "GetChainInfo",
                args: ["test-channel"]
            });
        });
    });

    describe("findBlockByTransaction()", () => {
        test("returns the block for the transaction", async () => {
            const source = new FabricQuery2Source(config, peerConfig);
            await source.init();

            (queryObj.build as jest.Mock).mockClear();
            (queryObj.send as jest.Mock).mockClear().mockImplementation(() => (
                {
                    queryResults: [
                        Buffer.from("This is some block")
                    ]
                }));
            (FabricBlock.fromQueryBytes as jest.Mock).mockClear().mockImplementation(() => ({
                blockNumber: 70
            }));

            await expect(source.findBlockByTransaction("a123")).resolves.toStrictEqual({
                blockNumber: 70
            });
            expect(queryObj.build).toBeCalledWith(identityContextObj, {
                fcn: "GetBlockByTxID",
                args: ["test-channel", "a123"]
            });
        });
    });
});

describe("FabricQuery2Plugin", () => {
    describe("constructor", () => {
        test("creates a FabricQuery2Plugin instance", () => {
            const _plugin = new FabricQuery2Plugin(configFile);
        });
        test("throws when invalid config is given", () => {
            expect(() => {
                const _plugin = new FabricQuery2Plugin("");
            }).toThrowError(BCVerifierError);
        });
        test("throws when config file does not exist", () => {
            expect(() => {
                const _plugin = new FabricQuery2Plugin(path.join(testDataDir, "config.non-existent.json"));
            }).toThrowError();
        });
    });
    describe("getDataModelType()", () => {
        test("returns KeyValue", () => {
            const plugin = new FabricQuery2Plugin(configFile);
            expect(plugin.getDataModelType()).toBe(DataModelType.KeyValue);
        });
    });
    describe("getBlockSources()", () => {
        test("returns one data source", async () => {
            const plugin = new FabricQuery2Plugin(configFile);

            const sources = await plugin.getBlockSources();
            expect(sources).toHaveLength(1);
        });
        test("returns multiple sources when multiple peers are specified", async () => {
            const plugin = new FabricQuery2Plugin(configMultiplePeersFile);

            const sources = await plugin.getBlockSources();
            expect(sources).toHaveLength(2);
        });
        test("throws when no peer is specified", async () => {
            const plugin = new FabricQuery2Plugin(configNoPeerFile);

            expect(plugin.getBlockSources()).rejects.toThrowError(BCVerifierError);
        });
    });
    describe("getPreferredBlockSource()", () => {
        test("returns the first data source", async () => {
            const plugin = new FabricQuery2Plugin(configFile);

            const sources = await plugin.getBlockSources();
            const preferred = await plugin.getPreferredBlockSource();

            expect(preferred).toBe(sources[0]);
        });
    });
});
