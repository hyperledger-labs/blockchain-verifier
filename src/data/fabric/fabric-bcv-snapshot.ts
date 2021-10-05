import { deserializeConfigTxInfo, serializeConfigTxInfo } from ".";
import { BCVerifierError, HashValueType } from "../../common";
import { KeyValueManagerInitialState } from "../../kvmanager";
import { BCVSnapshot, BCVSnapshotContext, BCVSnapshotData } from "../../snapshot";
import { FabricBlock, FabricConfigTransactionInfo, FabricTransaction } from "./fabric-data";

export interface FabricBCVSnapshotBlockInformation {
    hashForSelf: string;
    hashForPrev: string;
    lastConfigBlock: any;
}
export interface FabricBCVSnapshotKV {
    key: string;
    value: string;
    version: string;
}
export type FabricBCVSnapshotStateInformation = FabricBCVSnapshotKV[];

export interface FabricBCVSnapshotContext extends BCVSnapshotContext {
    block: FabricBlock;
    transaction: FabricTransaction;
    configInfo: FabricConfigTransactionInfo;
}

export interface FabricBCVSnapshotData extends BCVSnapshotData {
    blockInformation: FabricBCVSnapshotBlockInformation;
    stateInformation?: FabricBCVSnapshotStateInformation;
}

export class FabricBCVSnapshot extends BCVSnapshot {
    protected context: FabricBCVSnapshotContext | null;

    public constructor(pluginName: string, snapshotData: FabricBCVSnapshotData | null, context?: FabricBCVSnapshotContext) {
        super(pluginName, "fabric", snapshotData, context);

        if (snapshotData == null && context != null) {
            this.context = context;
        } else {
            this.context = null;
        }
    }

    public async getSnapshot(): Promise<FabricBCVSnapshotData> {
        if (this.context == null) {
            throw new BCVerifierError("No context is set. Snapshot cannot be generated");
        }

        const data: FabricBCVSnapshotData = {
            ...this.data,
            blockInformation: {
                hashForSelf: this.context.block.calcHashValue(HashValueType.HASH_FOR_SELF).toString("hex"),
                hashForPrev: this.context.block.calcHashValue(HashValueType.HASH_FOR_PREV).toString("hex"),
                lastConfigBlock: serializeConfigTxInfo(this.context.configInfo)
            }
        };

        if (this.context.state != null) {
            const keys = this.context.state.getKeys();
            data.stateInformation = keys.map((keyValue) => ({
                key: keyValue.getKey().toString("hex"),
                value: keyValue.getValue().toString("hex"),
                version: keyValue.getVersion().toString("hex")
            }));
        }

        return data;
    }

    public async getInitialKVState(): Promise<KeyValueManagerInitialState | undefined> {
        const state: FabricBCVSnapshotStateInformation = this.data.stateInformation;
        if (state == null) {
            return undefined;
        }

        return {
            lastBlockNumber: this.data.lastBlock,
            keyValueState: state.map((kv) => ({
                isDelete: false,
                key: Buffer.from(kv.key, "hex"),
                value: Buffer.from(kv.value, "hex"),
                version: Buffer.from(kv.version, "hex")
            }))
        };
    }

    public getLastConfigBlockInfo(): FabricConfigTransactionInfo {
        const info: FabricBCVSnapshotBlockInformation = this.data.blockInformation;
        if (info == null) {
            throw new Error("Snapshot does not contain valid block information");
        }
        return deserializeConfigTxInfo(info.lastConfigBlock);
    }
}
