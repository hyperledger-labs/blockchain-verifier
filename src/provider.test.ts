/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Block } from "./common";
import { correctBlocks, MockSource } from "./network/mock-block";
import { BlockProvider } from "./provider";

describe("BlockProvider", () => {
    const blockSource = new MockSource("mockSource", "mockOrg", correctBlocks);
    const blockSourceWithTx = new MockSource("mockSource", "mockOrg", correctBlocks, true);

    test("Good path", async () => {
        const provider = new BlockProvider(blockSource);

        await expect(provider.getBlock(1)).resolves.toBe(correctBlocks[1]);
        await expect(provider.getBlock(0)).resolves.toBe(correctBlocks[0]);

        await expect(provider.getBlockHash(0)).resolves.toEqual(correctBlocks[0].getHashValue());

        const tx = await provider.getTransaction("Tx1");
        expect(tx.getTransactionID()).toBe("Tx1");
        expect(tx.getTransactionType()).toBe(1);

        const provider2 = new BlockProvider(blockSource);
        await expect(provider2.cacheBlockRange(0, 1)).resolves.toBeUndefined();
        // cache again the cached block
        await expect(provider2.cacheBlockRange(1, 1)).resolves.toBeUndefined();

        const provider3 = new BlockProvider(blockSource);
        await expect(provider3.cacheBlockRange(0, 0)).resolves.toBeUndefined();
        await expect(provider3.cacheBlockRange(1, 1)).resolves.toBeUndefined();

        // Find a transaction with no block cached
        const provider4 = new BlockProvider(blockSource);
        const tx2 = await provider4.getTransaction("Tx2");
        expect(tx2.getTransactionID()).toBe("Tx2");
        expect(tx2.getTransactionType()).toBe(2);

        // Find a transaction with BlockSource's findTransaction enabled
        const provider5 = new BlockProvider(blockSourceWithTx);
        const tx3 = await provider5.getTransaction("Tx3");
        expect(tx3.getTransactionID()).toBe("Tx3");
        expect(tx3.getTransactionType()).toBe(3);

        // Find a transaction with BlockSource's findTransaction enabled and blocks cached
        const provider6 = new BlockProvider(blockSourceWithTx);
        await expect(provider6.cacheBlockRange(0, 1)).resolves.toBeUndefined();
        const tx4 = await provider6.getTransaction("Tx4");
        expect(tx4.getTransactionID()).toBe("Tx4");
        expect(tx4.getTransactionType()).toBe(1);
    });

    test("Error path", async () => {
        const provider = new BlockProvider(blockSource);

        await expect(provider.getBlock(-1)).rejects.toThrowError();
        await expect(provider.getBlock(correctBlocks.length)).rejects.toThrowError();
        await expect(provider.getBlock(9999)).rejects.toThrowError();
        await expect(provider.getBlockHash(-1)).rejects.toThrowError();
        await expect(provider.getBlockHash(correctBlocks.length)).rejects.toThrowError();
        await expect(provider.getBlockHash(9999)).rejects.toThrowError();

        await expect(provider.cacheBlockRange(1, 0)).rejects.toThrowError();
        await expect(provider.cacheBlockRange(9999, 10000)).rejects.toThrowError();
        await expect(provider.cacheBlockRange(-9999, 9999)).rejects.toThrowError();

        await expect(provider.getTransaction("TxNonExist")).rejects.toThrowError();

        const provider2 = new BlockProvider(blockSourceWithTx);
        await expect(provider2.getTransaction("TxNonExist")).rejects.toThrowError();
    });

    class StrangeSource extends MockSource {
        public async findBlockByTransaction(transactionID: string): Promise<Block> {
            return this.getBlock(1);
        }
    }

    test("Strange BlockSource", async () => {
        const provider = new BlockProvider(new StrangeSource("strange-source", "strange-org", correctBlocks));

        await expect(provider.getTransaction("Tx1")).rejects.toThrowError();
    });
});
