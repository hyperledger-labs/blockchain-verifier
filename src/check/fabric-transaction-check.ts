/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from "util";

import { TransactionCheckPlugin } from ".";
import { BCVCheckpoint } from "..";
import { ResultPredicate } from "../common";
import { FabricAction, FabricConfigTransactionInfo, FabricMetaDataIndex, FabricPrivateRWSet,
         FabricTransaction, verifyIdentityMSP, verifySignature, verifySignatureHeader } from "../data/fabric";
import { FabricBCVCheckpoint } from "../data/fabric/fabric-bcv-checkpoint";
import { FabricConfigCache } from "../data/fabric/fabric-utils";
import { BlockProvider } from "../provider";
import { ResultSet, TransactionResultPusher } from "../result-set";

export default class FabricTransactionIntegrityChecker implements TransactionCheckPlugin {
    public checkerName = "FabricTransactionIntegrityChecker";

    private provider: BlockProvider;
    private config: FabricConfigCache;
    private results: TransactionResultPusher;

    constructor(provider: BlockProvider, resultSet: ResultSet, checkpoint?: BCVCheckpoint) {
        this.provider = provider;
        this.results = new TransactionResultPusher(this.checkerName, resultSet);

        if (checkpoint != null) {
            const fabricCheckpoint = checkpoint as FabricBCVCheckpoint;
            this.config = FabricConfigCache.Init(provider, fabricCheckpoint);
        } else {
            this.config = FabricConfigCache.Init(provider);
        }
    }

    public async performCheck(transactionID: string): Promise<void> {
        const transaction = await this.provider.getTransaction(transactionID);
        this.results.setTransaction(transaction);

        if (!(transaction instanceof FabricTransaction)) {
            this.results.addSkipResult("performCheck", "Transaction is not a Fabric Transaction");
            return;
        }

        const metadataLastConfig = transaction.block.getMetaData(FabricMetaDataIndex.LAST_CONFIG).value?.index;
        const lastConfigBlock = metadataLastConfig == null ? 0 : metadataLastConfig;
        const configInfo = await this.config.getConfig(lastConfigBlock);

        if ((transaction.header.signature_header.creator.id_bytes as Buffer).byteLength === 0) {
            this.results.addSkipResult("performCheck", "No creator information");
            return;
        }

        if (transaction.getTransactionType() === 1 || transaction.getTransactionType() === 2) {
            this.results.addResult("performCheck",
                                   ResultPredicate.INVOKE,
                                   { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                   { name: transaction + ".SignatureHeader", value: transaction.header.signature_header },
                                   { name: configInfo.transactionId + ".Config.OrdererMSP", value: configInfo.ordererMSPs }
            );
        } else {
            this.results.addResult("performCheck",
                                   ResultPredicate.INVOKE,
                                   { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                   { name: transaction + ".SignatureHeader", value: transaction.header.signature_header },
                                   { name: configInfo.transactionId + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
            );
        }

        this.results.addResult("performCheck",
                               ResultPredicate.INVOKE,
                               { name: "VerifySignature", value: verifySignature },
                               { name: transaction + ".Signature", value: transaction.signature },
                               { name: transaction + ".Payload", value: transaction.getPayloadBytes() },
                               { name: transaction + ".SignatureHeader.Creator", value: transaction.header.signature_header.creator }
        );

        if (transaction.getTransactionType() === 3) {
            await this.checkNormalTransaction(transaction, configInfo);
        } else {
            this.results.addSkipResult("performCheck",
                                       "Transaction type (" + transaction.getTransactionType() + ") not supported");
        }
    }

    private async checkNormalTransaction(transaction: FabricTransaction,
                                         configInfo: FabricConfigTransactionInfo): Promise<void> {
        const actions = transaction.getActions();

        for (const action of actions) {
            // Check Proposal
            this.results.addResult("checkNormalTransaction",
                                   ResultPredicate.INVOKE,
                                   { name: "VerifySignatureHeader", value: verifySignatureHeader },
                                   { name: action + ".Header", value: action.decoded.header },
                                   { name: configInfo.transactionId + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
            );

            // Check Response
            const endorsements = action.getEndorsements();

            for (const i in endorsements) {
                const endorsement = endorsements[i];
                const endorsementStr = action + ".Endorsement[" + i + "]";

                await this.results.addAsyncResult("checkNormalTransaction",
                                                  ResultPredicate.INVOKE,
                                                  { name: "VerifyIdentityMSP", value: verifyIdentityMSP },
                                                  { name: endorsementStr + ".Endorser.MspID", value: endorsement.endorser.mspid },
                                                  { name: endorsementStr + ".Endorser.Identity", value: endorsement.endorser.id_bytes },
                                                  { name: configInfo.transactionId + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
                );

                this.results.addResult("checkNormalTransaction",
                                       ResultPredicate.INVOKE,
                                       { name: "VerifySignature", value: verifySignature },
                                       { name: endorsementStr + ".Signature", value: transaction.signature },
                                       { name: action + ".Response + " + endorsementStr + ".Endorser",
                                         value: transaction.getPayloadBytes() },
                                       { name: endorsementStr + ".Endorser", value: transaction.header.signature_header.creator }
                );
            }

            // Check Private Data
            const rwSets = action.getRWSets();
            for (const i in rwSets) {
                const rwSet = rwSets[i];

                if (rwSet.private_rwset != null && rwSet.private_rwset.length > 0) {
                    this.checkPrivateData(action, parseInt(i, 10), rwSet);
                }
            }
        }
    }

    private checkPrivateData(action: FabricAction, index: number, rwSet: any) {
        for (const i in rwSet.collection_hashed_rwset) {
            if (rwSet.private_rwset[i] == null) {
                // No data in the private DB. Ignore.
                continue;
            }
            const hashedRWSet = rwSet.collection_hashed_rwset[i];
            const privateRWSet = rwSet.private_rwset[i];

            const rwsetName = format("%s.rwSet[%d].CollectionRWSet[%d]", action, index, i);

            this.results.addResult("checkPrivateData",
                                   ResultPredicate.EQBIN,
                                   {
                                       name: rwsetName + ".PvtRWSetHash",
                                       value: hashedRWSet.pvt_rwset_hash
                                   },
                                   {
                                       name: "Hash(" + privateRWSet + ".RWSet)",
                                       value: FabricPrivateRWSet.calcHash(privateRWSet.rwSetBytes)
                                   }
            );

            const privateRWSetData = privateRWSet.getRWSet();
            this.results.addResult("checkPrivateData",
                                   ResultPredicate.EQ,
                                   { name: rwsetName + ".CollectionName",
                                     value: hashedRWSet.collection_name },
                                   { name: privateRWSet + ".CollectionName", value: privateRWSetData.collection_name }
            );

            // Check for Writes
            this.results.addResult("checkPrivateData",
                                   ResultPredicate.EQ,
                                   { name: rwsetName + ".RWSet.Writes.Length",
                                     value: hashedRWSet.hashed_rwset.hashed_writes.length },
                                   { name: privateRWSet + ".RWSet.Length", value: privateRWSetData.rwset.writes.length }
            );
            for (const k in hashedRWSet.hashed_rwset.hashed_writes) {
                const hashedWrite = hashedRWSet.hashed_rwset.hashed_writes[k];
                const privWrite = privateRWSetData.rwset.writes[k];

                const keyHash = FabricPrivateRWSet.calcHash(Buffer.from(privWrite.key));
                const valueHash = FabricPrivateRWSet.calcHash(privWrite.value);

                this.results.addResult("checkPrivateData", ResultPredicate.EQBIN,
                                       { name: format("%s.RWSet.Writes[%d].KeyHash", rwsetName, k),
                                         value: hashedWrite.key_hash },
                                       { name: format("Hash(%s.RWSet.Writes[%d].Key)", privateRWSet, k),
                                         value: keyHash }
                );

                this.results.addResult("checkPrivateData", ResultPredicate.EQBIN,
                                       { name: format("%s.RWSet.Writes[%d].ValueHash", rwsetName, k),
                                         value: hashedWrite.value_hash },
                                       { name: format("Hash(%s.RWSet.Writes[%d].Value)", privateRWSet, k),
                                         value: valueHash }
                );
            }
        }
    }
}
