import { deserializeConfigTxInfo, serializeConfigTxInfo } from ".";
import { BCVerifierError, HashValueType } from "../../common";
import { KeyValueManagerInitialState } from "../../kvmanager";
import { BCVCheckpoint, BCVCheckpointContext, BCVCheckpointData } from "../../checkpoint";
import { FabricBlock, FabricConfigTransactionInfo, FabricTransaction } from "./fabric-data";

export interface FabricBCVCheckpointBlockInformation {
    hashForSelf: string;
    hashForPrev: string;
    lastConfigBlock: any;
}
export interface FabricBCVCheckpointKV {
    key: string;
    value: string;
    version: string;
}
export type FabricBCVCheckpointStateInformation = FabricBCVCheckpointKV[];

export interface FabricBCVCheckpointContext extends BCVCheckpointContext {
    block: FabricBlock;
    transaction: FabricTransaction;
    configInfo: FabricConfigTransactionInfo;
}

export interface FabricBCVCheckpointData extends BCVCheckpointData {
    blockInformation: FabricBCVCheckpointBlockInformation;
    stateInformation?: FabricBCVCheckpointStateInformation;
}

export class FabricBCVCheckpoint extends BCVCheckpoint {
    protected context: FabricBCVCheckpointContext | null;

    public constructor(pluginName: string, checkpointData: FabricBCVCheckpointData | null, context?: FabricBCVCheckpointContext) {
        super(pluginName, "fabric", checkpointData, context);

        if (checkpointData == null && context != null) {
            this.context = context;
        } else {
            this.context = null;
        }
    }

    public async getCheckpoint(): Promise<FabricBCVCheckpointData> {
        if (this.context == null) {
            throw new BCVerifierError("No context is set. Checkpoint cannot be generated");
        }

        const data: FabricBCVCheckpointData = {
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
        const state: FabricBCVCheckpointStateInformation = this.data.stateInformation;
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
        const info: FabricBCVCheckpointBlockInformation = this.data.blockInformation;
        if (info == null) {
            throw new Error("Checkpoint does not contain valid block information");
        }
        return deserializeConfigTxInfo(info.lastConfigBlock);
    }
}
