/*
 * Copyright 2019-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from "path";

import { HashValueType, KeyValuePairWrite } from "../../common";
import { FabricBlockSource } from "../../network/fabric-block";
import { FabricFunctionInfo, FabricTransactionType } from "./fabric-data";

const testDataPathBase = path.join(__dirname, "..", "..", "..", "test");
const testDataset: { [name: string]: string } = {
    "fabcar-1.4.1": path.join(testDataPathBase, "fabcar-1.4.1"),
    "marbles-private-1.4.1": path.join(testDataPathBase, "marbles-private-1.4.1")
};

describe("Fabric Data", () => {
    let fabCarConfig: any;
    let fabCarBlockSource: FabricBlockSource;
    let marblesConfig: any;
    let marblesBlockSource: FabricBlockSource;

    beforeAll(async () => {
        const fabCarPath = testDataset["fabcar-1.4.1"];
        fabCarConfig = require(path.join(fabCarPath, "config.json"));
        fabCarBlockSource = await FabricBlockSource.createFromConfig({
            ledgerStore: path.join(fabCarPath, fabCarConfig.ledgers[0].ledgerStore)
        });

        const marblesPath = testDataset["marbles-private-1.4.1"];
        marblesConfig = require(path.join(marblesPath, "config.json"));
        marblesBlockSource = await FabricBlockSource.createFromConfig({
            ledgerStore: path.join(marblesPath, marblesConfig.ledgers[0].ledgerStore),
            privateDataStore: path.join(marblesPath, marblesConfig.ledgers[0].privateDataStore)
        });
    });
    afterAll(async () => {
        await marblesBlockSource.closePrivateDB();
    });

    test("Simple Transaction Block (fabcar:4)", async () => {
        const block = await fabCarBlockSource.getBlock(4);
        expect(block.getBlockNumber()).toBe(4);
        expect(block.getHashValue().toString("hex")).toBe(fabCarConfig.hashes[4]);
        expect(block.calcHashValue(HashValueType.HASH_FOR_SELF).toString("hex")).toBe(fabCarConfig.hashes[4]);

        const transactions = block.getTransactions();
        expect(transactions.length).toBe(1);

        const tx = transactions[0];
        expect(tx.getTransactionType()).toBe(FabricTransactionType.ENDORSER_TRANSACTION);
        expect(tx.getTransactionTypeString()).toBe("ENDORSER_TRANSACTION");
        expect(tx.validity).toBeTruthy();

        const actions = tx.getActions();
        expect(actions).toHaveLength(1);
        const funcInfo = actions[0].getFunction() as FabricFunctionInfo;
        expect(funcInfo).not.toBeNull();
        expect(funcInfo.ccName).toBe("fabcar");
        expect(funcInfo.funcName.toString()).toBe("initLedger");
        expect(funcInfo.args).toHaveLength(0);

        const set = tx.getWriteSet();
        expect(set.length).toBe(10);
        expect(set[0].key.toString()).toBe("fabcar\0CAR0");
        expect(set[9].key.toString()).toBe("fabcar\0CAR9");

        expect(set[3].isDelete).toBeFalsy();

        const pair = set[3] as KeyValuePairWrite;
        expect(JSON.parse(pair.value.toString())).toEqual({
            docType: "car", make: "Volkswagen", model: "Passat", color: "yellow", owner: "Max"
        });
        expect(set[5].version.toString()).toBe("4-0");

        const readSet = tx.getReadSet();
        expect(readSet.length).toBe(1);
        expect(readSet[0].key.toString()).toBe("lscc\0fabcar");
        expect(readSet[0].version.toString()).toBe("3-0");

        expect(() => block.getConfigTx()).toThrowError();
    });

    test("Simple Transaction Block with nontrivial readset (fabcar:7)", async () => {
        const block = await fabCarBlockSource.getBlock(7);
        const transactions = block.getTransactions();
        expect(transactions.length).toBe(1);
        const tx = transactions[0];

        const actions = tx.getActions();
        expect(actions).toHaveLength(1);
        const funcInfo = actions[0].getFunction() as FabricFunctionInfo;
        expect(funcInfo).not.toBeNull();
        expect(funcInfo.ccName).toBe("fabcar");
        expect(funcInfo.funcName.toString()).toBe("changeCarOwner");
        expect(funcInfo.args).toHaveLength(2);
        expect(funcInfo.args[0].toString()).toBe("CAR0");

        const readSet = tx.getReadSet();
        expect(readSet.length).toBe(2);
        expect(readSet[0].key.toString()).toBe("fabcar\0CAR0");
        expect(readSet[0].version.toString()).toBe("4-0"); // written by initLedger (Block 4, Tx 0)

        const writeSet = tx.getWriteSet();
        expect(writeSet[0].key.toString()).toBe("fabcar\0CAR0");
        expect(writeSet[0].isDelete).toBeFalsy();
        expect(JSON.parse((writeSet[0] as KeyValuePairWrite).value.toString())).toEqual({
            docType: "car", make: "Toyota", model: "Prius", color: "blue", owner: "Ai"
        });
    });

    test("Multiple Transactions Block (marbles:4)", async () => {
        const block = await marblesBlockSource.getBlock(4);
        expect(block.getBlockNumber()).toBe(4);

        const transactions = block.getTransactions();
        expect(transactions.length).toBe(3);

        const set = transactions[2].getWriteSet();
        expect(set.length).toBe(0);

        expect(transactions[1].validity).toBeTruthy();
    });

    test("Config Block", async () => {
        const block = await fabCarBlockSource.getBlock(0);
        const transactions = block.getTransactions();
        expect(transactions.length).toBe(1);
        const configTx = block.getConfigTx();
        expect(configTx.getTransactionType()).toBe(FabricTransactionType.CONFIG);

        const info = block.getConfigTxInfo();
        expect(info.blockNumber).toBe(0);
        expect(info.transactionId).toBe(transactions[0].getTransactionID());
        expect(info.applicationMSPs).toHaveLength(2);
        expect(info.applicationMSPs[0].name).toBe("Org1MSP");
        expect(info.applicationMSPs[1].name).toBe("Org2MSP");
        expect(info.ordererMSPs).toHaveLength(1);
        expect(info.ordererMSPs[0].name).toBe("OrdererMSP");

        // Config Update (but in a block, it is config tx)
        const blockUpdate = await marblesBlockSource.getBlock(2);
        const configTx2 = blockUpdate.getConfigTx();
        expect(configTx2.getTransactionType()).toBe(FabricTransactionType.CONFIG);

        const info2 = blockUpdate.getConfigTxInfo();
        expect(info2.blockNumber).toBe(2);
        expect(info2.transactionId).toBe(configTx2.getTransactionID());
        expect(info2.applicationMSPs).toHaveLength(2);
    });
});
