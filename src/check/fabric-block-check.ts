/*
 * Fabric block integrity check
 *
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { common } from "fabric-protos";
import { BlockCheckPlugin } from ".";
import { BCVCheckpoint } from "..";
import { ResultPredicate } from "../common";
import { FabricBlock, FabricConfigTransactionInfo, FabricMetaDataIndex, verifyMetadataSignature, verifySignatureHeader } from "../data/fabric";
import { FabricBCVCheckpoint } from "../data/fabric/fabric-bcv-checkpoint";
import { FabricConfigCache } from "../data/fabric/fabric-utils";
import { BlockProvider } from "../provider";
import { BlockResultPusher, ResultSet } from "../result-set";

export default class FabricBlockIntegrityChecker implements BlockCheckPlugin {
    public checkerName = "FabricBlockIntegrityChecker";

    private provider: BlockProvider;
    private config: FabricConfigCache;
    private results: BlockResultPusher;

    constructor(provider: BlockProvider, resultSet: ResultSet, checkpoint?: BCVCheckpoint) {
        this.provider = provider;
        this.results = new BlockResultPusher(this.checkerName, resultSet);

        if (checkpoint != null) {
            const fabricCheckpoint = checkpoint as FabricBCVCheckpoint;
            this.config = FabricConfigCache.Init(provider, fabricCheckpoint);
        } else {
            this.config = FabricConfigCache.Init(provider);
        }
    }

    public async performCheck(blockNumber: number): Promise<void> {
        const block = await this.provider.getBlock(blockNumber);

        this.results.setBlock(block);

        if (!(block instanceof FabricBlock)) {
            this.results.addSkipResult("performCheck", "Not FabricBlock");
            return;
        }

        const configInfo = await this.checkLastConfig(block);

        await this.checkMetadataSignature(block, configInfo);
    }

    private checkLastConfigIndex(index: number, block: FabricBlock): void {
        this.results.addResult("checkLastConfigIndex",
                               ResultPredicate.LE,
                               { name: block + ".Metadata[1].LastConfig.Value", value: index },
                               { name: block + ".Number", value: block.getBlockNumber() });
    }

    private async checkLastConfig(block: FabricBlock): Promise<FabricConfigTransactionInfo> {
        const index = block.getLastConfigBlockIndex();
        // XXX: Better to use raw value due to different implementation of encoding zero
        // https://github.com/protobufjs/protobuf.js/issues/1138
        const lastConfigObj: { index?: number } = {};
        if (index !== 0) {
            lastConfigObj.index = index;
        }
        const lastConfigValue = common.LastConfig.encode(lastConfigObj).finish();

        this.checkLastConfigIndex(index, block);

        const lastConfig = block.getMetaData(FabricMetaDataIndex.LAST_CONFIG);
        for (const i in lastConfig.signatures) {
            const signature = lastConfig.signatures[i];

            this.results.addResult("CheckLastConfig",
                                   ResultPredicate.INVOKE,
                                   { name: "VerifyMetadataSignature", value: verifyMetadataSignature },
                                   { name: block.toString(), value: block },
                                   { name: block + ".Metadata[1].LastConfig", value: lastConfigValue },
                                   { name: block + ".Metadata[1].Signature[" + i + "]", value: signature }
            );
        }

        const configInfo = await this.config.getConfig(index);
        const ordererMSPs = configInfo.ordererMSPs;

        for (const i in lastConfig.signatures) {
            const signature = lastConfig.signatures[i];

            // VerifySignatureHeader(signature.signature_header, ordererMSPs)
            await this.results.addAsyncResult("CheckLastConfig",
                                              ResultPredicate.INVOKE,
                                              { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                              { name: block + ".Metadata[1].Signature.Creator",
                                                value: signature.signature_header },
                                              { name: configInfo.transactionId + ".Config.OrdererMSPs", value: ordererMSPs });
        }

        return configInfo;
    }

    private async checkMetadataSignature(block: FabricBlock, configInfo: FabricConfigTransactionInfo): Promise<void> {
        const signatures = block.getMetaData(FabricMetaDataIndex.SIGNATURES);
        const ordererMSPs = configInfo.ordererMSPs;

        for (const i in signatures.signatures) {
            const signature = signatures.signatures[i];
            this.results.addResult("CheckMetadataSignature",
                                   ResultPredicate.INVOKE,
                                   { name: "VerifyMetadataSignature", value: verifyMetadataSignature },
                                   { name: block.toString(), value: block },
                                   { name: "None", value: Buffer.from(signatures.value) },
                                   { name: block + ".Metadata[0].Signature[" + i + "]", value: signature }
            );

            // VerifySignatureHeader(signature.signature_header, ordererMSPs)
            await this.results.addAsyncResult("CheckLastConfig",
                                              ResultPredicate.INVOKE,
                                              { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                              { name: block + ".Metadata[1].Signature.Creator", value: signature.signature_header },
                                              { name: configInfo.transactionId + ".Config.OrdererMSPs", value: ordererMSPs }
            );
        }
    }
}
