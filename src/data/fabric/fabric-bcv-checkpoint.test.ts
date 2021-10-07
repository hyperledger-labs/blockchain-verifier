import { HashValueType } from "../../common";
import { FabricBCVCheckpoint, FabricBCVCheckpointContext } from "./fabric-bcv-checkpoint";

describe("FabricBCVCheckpoint", () => {
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
    const mockLastConfigInfo = {
        blockNumber: 24,
        transactionId: "tx-id-for-configtx",
        applicationMSPs: [],
        ordererMSPs: [],
    };
    const mockState = {
        getKeys: () => [{
            getKey: () => Buffer.from("KEY0123"),
            getValue: () => Buffer.from("VALUE0123"),
            getVersion: () => Buffer.from("VERSION0123")
        }]
    };
    const now = Date.now();
    const context: FabricBCVCheckpointContext = {
        block: mockLastBlock as any,
        transaction: mockLastTransaction as any,
        configInfo: mockLastConfigInfo,
        state: mockState as any,
        timestamp: now
    };

    test("constructor is initialized successfully with context", () => {
        new FabricBCVCheckpoint("test", null, context);
    });

    test("constructor throws when neither data nor context is passed", () => {
        expect(() => {
            new FabricBCVCheckpoint("test", null);
        }).toThrowError();
    });

    test("getCheckpoint with context returns a valid checkpoint data", async () => {
        const checkpoint = new FabricBCVCheckpoint("test", null, context);
        const data = await checkpoint.getCheckpoint();

        expect(data.lastBlock).toBe(42);
        expect(data.lastTransaction).toBe("tx-id-for-last");
        expect(data.timestamp).toBe(now);
        expect(data.networkPlugin).toBe("test");
        expect(data.checkpointDataType).toBe("fabric");
        expect(Buffer.from(data.blockInformation.hashForPrev, "hex").toString("utf-8")).toBe("test-hash-for-prev");
        expect(Buffer.from(data.blockInformation.hashForSelf, "hex").toString("utf-8")).toBe("test-hash-for-self");
        expect(data.blockInformation.lastConfigBlock.blockNumber).toBe(24);

        expect(data).toHaveProperty("stateInformation");
        if(data.stateInformation != null) { // Condition to satisfy the compiler
            expect(data.stateInformation).toHaveLength(1);
            expect(Buffer.from(data.stateInformation[0].key, "hex").toString("utf-8")).toBe("KEY0123");
            expect(Buffer.from(data.stateInformation[0].value, "hex").toString("utf-8")).toBe("VALUE0123");
            expect(Buffer.from(data.stateInformation[0].version, "hex").toString("utf-8")).toBe("VERSION0123");
        }
    });
});
