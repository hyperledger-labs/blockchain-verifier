import { HashValueType } from "../../common";
import { FabricBCVSnapshot, FabricBCVSnapshotContext } from "./fabric-bcv-snapshot";

describe("FabricBCVSnapshot", () => {
    const mockLastBlock = {
        calcHashValue: (type: HashValueType) => {
            if (type === HashValueType.HASH_FOR_PREV) {
                return Buffer.from("test-hash-for-prev");
            } else {
                return Buffer.from("test-hash-for-self");
            }
        },
        getBlockNumber: () => 42
    };
    const mockLastTransaction = {
        getBlock: () => mockLastBlock,
        getTransactionID: () => "tx-id-for-last"
    };
    const mockLastConfigBlock = {
        getBlockNumber: () => 24,
        getConfigTxInfo: () => ({
            blockNumber: 24,
            transactionID: "tx-id-for-configtx"
        })
    };
    const mockState = {
        getKeys: () => [{
            getKey: () => Buffer.from("KEY0123"),
            getValue: () => Buffer.from("VALUE0123"),
            getVersion: () => Buffer.from("VERSION0123")
        }]
    };
    const now = Date.now();
    const context: FabricBCVSnapshotContext = {
        block: mockLastBlock as any,
        transaction: mockLastTransaction as any,
        configBlock: mockLastConfigBlock as any,
        state: mockState as any,
        timestamp: now
    };

    test("constructor is initialized successfully with context", () => {
        new FabricBCVSnapshot("test", null, context);
    });

    test("constructor throws when neither data nor context is passed", () => {
        expect(() => {
            new FabricBCVSnapshot("test", null);
        }).toThrowError();
    });

    test("getSnapshot with context returns a valid snapshot data", async () => {
        const snapshot = new FabricBCVSnapshot("test", null, context);
        const data = await snapshot.getSnapshot();

        expect(data.lastBlock).toBe(42);
        expect(data.lastTransaction).toBe("tx-id-for-last");
        expect(data.timestamp).toBe(now);
        expect(data.networkPlugin).toBe("test");
        expect(data.snapshotDataType).toBe("fabric");
        expect(Buffer.from(data.blockInformation.hashForPrev, "hex").toString("utf-8")).toBe("test-hash-for-prev");
        expect(Buffer.from(data.blockInformation.hashForSelf, "hex").toString("utf-8")).toBe("test-hash-for-self");
        expect(data.blockInformation.lastConfigBlock.blockNumber).toBe(24);
        expect(data.stateInformation).toHaveLength(1);
        expect(Buffer.from(data.stateInformation[0].key, "hex").toString("utf-8")).toBe("KEY0123");
        expect(Buffer.from(data.stateInformation[0].value, "hex").toString("utf-8")).toBe("VALUE0123");
        expect(Buffer.from(data.stateInformation[0].version, "hex").toString("utf-8")).toBe("VERSION0123");
    });
});
