/*
 * Fabric block integrity check
 *
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { common } from "fabric-protos";
import { BlockCheckPlugin } from ".";
import { BCVerifierError, ResultPredicate } from "../common";
import { FabricBlock, FabricMetaDataIndex, FabricTransaction, getOrdererMSPs,
         verifyMetadataSignature, verifySignatureHeader } from "../data/fabric";
import { BlockProvider } from "../provider";
import { BlockResultPusher, ResultSet } from "../result-set";

export default class FabricBlockIntegrityChecker implements BlockCheckPlugin {
    public checkerName = "FabricBlockIntegrityChecker";
    private provider: BlockProvider;
    private results: BlockResultPusher;

    constructor(provider: BlockProvider, resultSet: ResultSet) {
        this.provider = provider;
        this.results = new BlockResultPusher(this.checkerName, resultSet);
    }

    public async performCheck(blockNumber: number): Promise<void> {
        const block = await this.provider.getBlock(blockNumber);

        this.results.setBlock(block);

        if (!(block instanceof FabricBlock)) {
            this.results.addSkipResult("performCheck", "Not FabricBlock");
            return;
        }

        const configTx = await this.checkLastConfig(block);

        await this.checkMetadataSignature(block, configTx);
    }

    private checkLastConfigIndex(lastConfig: any, block: FabricBlock): void {
        this.results.addResult("checkLastConfigIndex",
            ResultPredicate.LE,
            { name: block + ".Metadata[1].LastConfig.Value", value: lastConfig.value.index },
            { name: block + ".Number", value: block.getBlockNumber() });
    }

   private async checkLastConfig(block: FabricBlock): Promise<FabricTransaction> {
        const lastConfig = block.getMetaData(FabricMetaDataIndex.LAST_CONFIG);
        // XXX: Better to use raw value due to different implementation of encoding zero
        // https://github.com/protobufjs/protobuf.js/issues/1138
        const lastConfigObj: { index?: number } = {};
        // XXX: May cause issue in big number (> 53 bit)
        const index = parseInt(lastConfig.value.index, 10);
        if (index !== 0) {
            lastConfigObj.index = index;
        }
        const lastConfigValue = common.LastConfig.encode(lastConfigObj).finish();

        this.checkLastConfigIndex(lastConfig, block);

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

        const lastConfigBlock = await this.provider.getBlock(lastConfig.value.index);
        if (!(lastConfigBlock instanceof FabricBlock)) {
            throw new BCVerifierError("config block is not FabricBlock");
        }
        const configTx = lastConfigBlock.getConfigTx();
        const ordererMSPs = getOrdererMSPs(configTx);

        for (const i in lastConfig.signatures) {
            const signature = lastConfig.signatures[i];

            // VerifySignatureHeader(signature.signature_header, ordererMSPs)
            await this.results.addAsyncResult("CheckLastConfig",
                                              ResultPredicate.INVOKE,
                                              { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                              { name: block + ".Metadata[1].Signature.Creator",
                                                value: signature.signature_header },
                                              { name: configTx + ".Config.OrdererMSPs", value: ordererMSPs });
        }

        return configTx;
    }

    private async checkMetadataSignature(block: FabricBlock, configTx: FabricTransaction): Promise<void> {
        const signatures = block.getMetaData(FabricMetaDataIndex.SIGNATURES);
        const ordererMSPs = getOrdererMSPs(configTx);

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
                { name: configTx + ".Config.OrdererMSPs", value: ordererMSPs }
            );
        }
    }
}
