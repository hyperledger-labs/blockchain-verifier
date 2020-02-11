/*
 * Copyright 2019 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BCVerifierNotFound, KeyValuePairWrite, KeyValueTransaction } from "./common";
import { KeyValueManagerBlockNotSufficientError, SimpleKeyValueManager } from "./kvmanager";
import { correctKVBlocks } from "./mock/mock-block";

describe("SimpleKeyValueManager", () => {
    test("good path without initial state", async () => {
        const manager = new SimpleKeyValueManager();

        expect(manager.getNextDesiredBlockNumber()).toBe(0);
        expect(manager.feedBlock(correctKVBlocks[0])).toBeTruthy();
        expect(manager.getVersionsForKey(Buffer.from("key1")).length).toBe(1);
        expect(manager.getVersionsForKey(Buffer.from("key2")).length).toBe(0);

        expect(manager.feedBlock(correctKVBlocks[1])).toBeTruthy();
        expect(manager.feedBlock(correctKVBlocks[2])).toBeTruthy();
        expect(manager.getNextDesiredBlockNumber()).toBe(3);
        // key1: w, w, d
        expect(manager.getVersionsForKey(Buffer.from("key1")).length).toBe(3);
        // key2: w, w
        expect(manager.getVersionsForKey(Buffer.from("key2")).length).toBe(2);

        const key1 = manager.getVersionsForKey(Buffer.from("key1"));
        expect(key1[0].isDelete).toBeFalsy();
        expect(key1[2].isDelete).toBeTruthy();
        expect((key1[1].transaction as KeyValueTransaction).getTransactionID()).toBe("Tx5");
        expect((key1[2].transaction as KeyValueTransaction).getTransactionID()).toBe("Tx6");

        const key1Write = key1[0] as KeyValuePairWrite;
        expect(key1Write.value.toString()).toBe("A");

        const state0 = manager.getState(correctKVBlocks[0]);
        expect(state0.getKeys().length).toBe(1);
        expect(state0.getValue(Buffer.from("key1")).getValue().toString()).toBe("A");
        const state1 = manager.getState(correctKVBlocks[1]);
        expect(state1.getKeys().length).toBe(3);
        expect(state1.getValue(Buffer.from("key2")).getValue().toString()).toBe("1");
        expect(state1.getValue(Buffer.from("key1")).getValue().toString()).toBe("A");
        const state2 = manager.getState(correctKVBlocks[2]);
        expect(state2.getKeys().length).toBe(2);
        expect(state2.getValue(Buffer.from("key2")).getValue().toString()).toBe("3");
        expect(() => state2.getValue(Buffer.from("key1"))).toThrow(BCVerifierNotFound);

        const value2 = state2.getValue(Buffer.from("key2"));
        const tx = await value2.getTransaction() as KeyValueTransaction;
        expect(tx).not.toBeNull();
        expect(tx.getTransactionID()).toBe("Tx5");
        expect(value2.getVersion().toString()).toBe("2*0");
        expect(value2.getKey().toString()).toBe("key2");
        const history2 = await value2.getHistory();
        expect(history2.length).toBe(2);

        const value3 = state2.getValue(Buffer.from("key3"));
        const history3 = await value3.getHistory();
        expect(history3.length).toBe(1);
    });

    test("error without initial state", async () => {
        const manager = new SimpleKeyValueManager();

        expect(() => manager.getState(correctKVBlocks[0])).toThrow(KeyValueManagerBlockNotSufficientError);
        expect(manager.feedBlock(correctKVBlocks[1])).toBeFalsy();
    });

    test("good path with initial state", async () => {
        const initialState: KeyValuePairWrite[] = [{
            key: Buffer.from("key1"),
            value: Buffer.from("1"),
            version: Buffer.from("1*1"),
            isDelete: false,
        }, {
            key: Buffer.from("key2"),
            value: Buffer.from("4"),
            version: Buffer.from("1*1"),
            isDelete: false
        }];

        const manager = new SimpleKeyValueManager({
            lastBlockNumber: 1,
            keyValueState: initialState
        });

        expect(manager.getNextDesiredBlockNumber()).toBe(2);
        expect(manager.feedBlock(correctKVBlocks[1])).toBeFalsy();
        expect(manager.feedBlock(correctKVBlocks[2])).toBeTruthy();

        const version1 = manager.getVersionsForKey(Buffer.from("key1"));
        expect(version1.length).toBe(3);
        expect(version1[0].transaction).toBeNull();
        expect((version1[1].transaction as KeyValueTransaction).getTransactionID()).toBe("Tx5");
        expect((version1[2].transaction as KeyValueTransaction).getTransactionID()).toBe("Tx6");

        const state = manager.getState(correctKVBlocks[2]);
        const value2 = state.getValue(Buffer.from("key2"));
        expect(value2.getValue().toString()).toBe("3");
        const history2 = await value2.getHistory();
        expect(history2.length).toBe(2);
    });

    test("error with initial state", async () => {
        const initialState: KeyValuePairWrite[] = [{
            key: Buffer.from("key1"),
            value: Buffer.from("10"),
            version: Buffer.from("10*1"),
            isDelete: false,
        }];

        const manager = new SimpleKeyValueManager({
            lastBlockNumber: 100,
            keyValueState: initialState
        });

        expect(manager.getNextDesiredBlockNumber()).toBe(101);
        expect(() => manager.getState(correctKVBlocks[0])).toThrow(BCVerifierNotFound);
    });
 });
