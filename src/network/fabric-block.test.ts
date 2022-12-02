/*
 * Copyright 2019-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from "path";

import { BCVerifierError, BCVerifierNotImplemented } from "../common";
import { DataModelType } from "../network-plugin";
import FabricBlockPlugin, { FabricBlockSource } from "./fabric-block";

const testDataPathBase = path.join(__dirname, "..", "..", "test");

const testDataset: { [name: string]: string } = {
    "asset-transfer-basic-2.4.7": path.join(testDataPathBase, "asset-transfer-basic-2.4.7"),
    "asset-transfer-private-data-2.4.7": path.join(testDataPathBase, "asset-transfer-private-data-2.4.7")
};

describe("FabricBlockSource", () => {
    for (const dataName in testDataset) {
        const dataPath = testDataset[dataName];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const dataConfig = require(path.join(dataPath, "config.json"));

        test("Create BlockSource - " + dataName, async () => {
            expect(FabricBlockSource.createFromConfig({
                blockFile: path.join(dataPath, dataConfig.ledgers[0].blockFile)
            })).resolves.toBeDefined();

            expect(FabricBlockSource.createFromConfig({
                ledgerStore: path.join(dataPath, dataConfig.ledgers[0].ledgerStore)
            })).resolves.toBeDefined();

            const source = await FabricBlockSource.createFromConfig({
                ledgerStore: path.join(dataPath, dataConfig.ledgers[0].ledgerStore)
            });
            expect(source.getBlockHeight()).resolves.toBe(dataConfig.blockHeight);
            expect(source.getSourceOrganizationID()).toBe("file");
            expect(source.getSourceID()).toBe(path.join(dataPath, dataConfig.ledgers[0].ledgerStore));
            expect(source.findBlockByTransaction("AAAA")).rejects.toBeInstanceOf(BCVerifierNotImplemented);

            expect((await source.getBlockHash(0)).toString("hex")).toBe(dataConfig.hashes[0]);
            expect(source.getBlock(0)).resolves.toBeDefined();

            const block = await source.getBlock(0);
            expect(block.getHashValue().toString("hex")).toBe(dataConfig.hashes[0]);

            const block1 = await source.getBlock(1);
            expect(source.getBlockRange(0, 1)).resolves.toEqual([ block, block1 ]);

            const height = await source.getBlockHeight();
            for (let i = 0; i < height; i++) {
                const b = await source.getBlock(i);
                expect(b.getHashValue().toString("hex")).toBe(dataConfig.hashes[i]);
                expect(b.getTransactions().length).toBe(dataConfig.numTransactions[i]);
            }

            // Try private data store if exists
            if (dataConfig.ledgers[0].privateDataStore == null) {
                return;
            }
            //
            const sourceWithPrivate = await FabricBlockSource.createFromConfig({
                blockFile: path.join(dataPath, dataConfig.ledgers[0].blockFile),
                privateDataStore: path.join(dataPath, dataConfig.ledgers[0].privateDataStore)
            });
            expect(sourceWithPrivate).toBeDefined();
            await sourceWithPrivate.closePrivateDB();
        });
    }

    test("Create BlockSource - Non Existent", async () => {
        expect(FabricBlockSource.createFromConfig({})).rejects.toBeInstanceOf(BCVerifierError);
        expect(FabricBlockSource.createFromConfig({
            blockFile: "/dev/null/non-existent"
        })).rejects.toThrowError();
    });
});

describe("FabricBlockPlugin", () => {
    for (const dataName in testDataset) {
        const dataPath = testDataset[dataName];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const dataConfig = require(path.join(dataPath, "config.json"));

        // test for the first set only
        test("FabricBlockPlugin - " + dataName, async () => {
            const plugin1 = new FabricBlockPlugin(path.join(dataPath, dataConfig.ledgers[0].ledgerStore));
            expect(plugin1.getDataModelType()).toBe(DataModelType.KeyValue);

            const sources = await plugin1.getBlockSources();
            expect(sources.length).toBe(1);
            const preferred = await plugin1.getPreferredBlockSource();
            expect(preferred).toBe(sources[0]);
            expect(preferred.getBlockHeight()).resolves.toBe(dataConfig.blockHeight);

            const plugin2 = new FabricBlockPlugin(path.join(dataPath, dataConfig.ledgers[0].blockFile));
            const sources2 = await plugin2.getBlockSources();
            expect(sources2.length).toBe(1);
            const preferred2 = await plugin2.getPreferredBlockSource();
            expect(preferred2.getBlockHeight()).resolves.toBe(dataConfig.blockHeight);
        });
        break;
    }
});
