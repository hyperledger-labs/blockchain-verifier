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
    "asset-transfer-basic-2.4.7": path.join(testDataPathBase, "asset-transfer-basic-2.4.7")
};

describe("Fabric Data", () => {
    let assetTransferConfig: any;
    let assetTransferBlockSource: FabricBlockSource;

    beforeAll(async () => {
        const assetTransferPath = testDataset["asset-transfer-basic-2.4.7"];
        assetTransferConfig = require(path.join(assetTransferPath, "config.json"));
        assetTransferBlockSource = await FabricBlockSource.createFromConfig({
            ledgerStore: path.join(assetTransferPath, assetTransferConfig.ledgers[0].ledgerStore)
        });
    });

    test("Simple Transaction Block (basic:6)", async () => {
        const blockNumber = 6;

        const block = await assetTransferBlockSource.getBlock(blockNumber);
        expect(block.getBlockNumber()).toBe(blockNumber);
        expect(block.getHashValue().toString("hex")).toBe(assetTransferConfig.hashes[blockNumber]);
        expect(block.calcHashValue(HashValueType.HASH_FOR_SELF).toString("hex")).toBe(assetTransferConfig.hashes[blockNumber]);

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
        expect(funcInfo.ccName).toBe("basic");
        expect(funcInfo.funcName.toString()).toBe("InitLedger");
        expect(funcInfo.args).toHaveLength(0);

        const set = tx.getWriteSet();
        expect(set.length).toBe(6);
        expect(set[0].key.toString()).toBe("basic\0asset1");
        expect(set[5].key.toString()).toBe("basic\0asset6");

        expect(set[3].isDelete).toBeFalsy();

        const pair = set[2] as KeyValuePairWrite;
        expect(JSON.parse(pair.value.toString())).toEqual({
            docType: "asset", ID: "asset3", Color: "green", Size: 10, Owner: "Jin Soo", AppraisedValue: 500
        });
        expect(set[5].version.toString()).toBe("6-0");

        const readSet = tx.getReadSet();
        expect(readSet.length).toBe(1);
        expect(readSet[0].key.toString()).toBe("_lifecycle\0namespaces/fields/basic/Sequence");
        expect(readSet[0].version.toString()).toBe("5-0");

        expect(() => block.getConfigTx()).toThrowError();
    });

    test("Simple Transaction Block with nontrivial readset (basic:8)", async () => {
        const blockNumber = 8;

        const block = await assetTransferBlockSource.getBlock(blockNumber);
        expect(block.getBlockNumber()).toBe(blockNumber);

        const transactions = block.getTransactions();
        expect(transactions.length).toBe(1);
        const tx = transactions[0];

        const actions = tx.getActions();
        expect(actions).toHaveLength(1);
        const funcInfo = actions[0].getFunction() as FabricFunctionInfo;
        expect(funcInfo).not.toBeNull();
        expect(funcInfo.ccName).toBe("basic");
        expect(funcInfo.funcName.toString()).toBe("UpdateAsset");
        expect(funcInfo.args).toHaveLength(5);
        expect(funcInfo.args[0].toString()).toBe("asset1");
        expect(funcInfo.args[3].toString()).toBe("Tomoko");

        const readSet = tx.getReadSet();
        expect(readSet.length).toBe(2);
        expect(readSet[1].key.toString()).toBe("basic\0asset1");
        expect(readSet[1].version.toString()).toBe("6-0"); // written by InitLedger (Block 6, Tx 0)

        const writeSet = tx.getWriteSet();
        expect(writeSet.length).toBe(1);
        expect(writeSet[0].key.toString()).toBe("basic\0asset1");
        expect(writeSet[0].isDelete).toBeFalsy();
        expect(JSON.parse((writeSet[0] as KeyValuePairWrite).value.toString())).toEqual({
            ID: "asset1", Color: "blue", Size: 5, Owner: "Tomoko", AppraisedValue: 350
        });
    });

    test("Config Block", async () => {
        const block = await assetTransferBlockSource.getBlock(0);
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
    });
});
