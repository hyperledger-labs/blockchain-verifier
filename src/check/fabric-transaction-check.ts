/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { MSPConfig } from "fabric-client/lib/BlockDecoder";
import { format } from "util";

import { BCVerifierError, CheckResult, ResultPredicate, TransactionCheckPlugin } from "../common";
import { FabricAction, FabricBlock, FabricMetaDataIndex, FabricPrivateRWSet,
         FabricTransaction } from "../data/fabric-data";
import { getApplicationMSPs, getOrdererMSPs, verifyIdentityMSP, verifySignature,
         verifySignatureHeader } from "../data/fabric-utils";
import { BlockProvider } from "../provider";
import { ResultSet, TransactionResultPusher } from "../result-set";

export interface FabricConfigTransactionInfo {
    blockNumber: number;
    transaction: FabricTransaction;
    ordererMSPs: MSPConfig[];
    applicationMSPs: MSPConfig[];
}

export class FabricConfigCache {
    private configMap: { [configBlockNumber: number]: FabricConfigTransactionInfo };
    private provider: BlockProvider;

    constructor(provider: BlockProvider) {
        this.configMap = {};
        this.provider = provider;
    }

    public async getConfig(blockNumber: number): Promise<FabricConfigTransactionInfo> {
        if (this.configMap[blockNumber] == null) {
            const configBlock = await this.provider.getBlock(blockNumber);

            if (!(configBlock instanceof FabricBlock)) {
                throw new BCVerifierError("Provider does not return FabricBlock");
            }
            const txs = configBlock.getTransactions();
            if (txs.length !== 1 || txs[0].getTransactionType() !== 1) {
                throw new BCVerifierError("Not a single tx in a config block or not a config tx");
            }
            const configTx = txs[0];

            this.configMap[blockNumber] = {
                applicationMSPs: getApplicationMSPs(configTx),
                blockNumber: blockNumber,
                ordererMSPs: getOrdererMSPs(configTx),
                transaction: configTx
            };
        }
        return this.configMap[blockNumber];
    }
}

export default class FabricTransactionIntegrityChecker implements TransactionCheckPlugin {
    public checkerName = "FabricTransactionIntegrityChecker";
    private provider: BlockProvider;
    private config: FabricConfigCache;
    private results: TransactionResultPusher;

    constructor(provider: BlockProvider, resultSet: ResultSet) {
        this.provider = provider;
        this.config = new FabricConfigCache(provider);
        this.results = new TransactionResultPusher(this.checkerName, resultSet);
    }

    public async performCheck(transactionID: string): Promise<void> {
        const transaction = await this.provider.getTransaction(transactionID);
        this.results.setTransaction(transaction);

        if (!(transaction instanceof FabricTransaction)) {
            this.results.addSkipResult("performCheck", "Transaction is not a Fabric Transaction");
            return;
        }

        const lastConfigBlock = transaction.block.getMetaData(FabricMetaDataIndex.LAST_CONFIG).value.index;
        const configInfo = await this.config.getConfig(lastConfigBlock);

        if (transaction.getTransactionType() === 1 || transaction.getTransactionType() === 2) {
            this.results.addResult("performCheck",
                ResultPredicate.INVOKE,
                { name: "VerifySignatureHeader", value: verifySignatureHeader },
                { name: transaction + ".SignatureHeader", value: transaction.header.signature_header },
                { name: configInfo.transaction + ".Config.OrdererMSP", value: configInfo.ordererMSPs }
            );
        } else {
            this.results.addResult("performCheck",
                ResultPredicate.INVOKE,
                { name: "VerifySignatureHeader", value: verifySignatureHeader },
                { name: transaction + ".SignatureHeader", value: transaction.header.signature_header },
                { name: configInfo.transaction + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
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
        const results: CheckResult[] = [];

        for (const action of actions) {
            // Check Proposal
            this.results.addResult("checkNormalTransaction",
                ResultPredicate.INVOKE,
                { name: "VerifySignatureHeader", value: verifySignatureHeader },
                { name: action + ".Header", value: action.decoded.header },
                { name: configInfo.transaction + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
            );

            // Check Response
            const response = action.getResponseBytes();
            const endorsements = action.getEndorsements();
            const rawEndorsers = action.getEndorsersBytes();

            for (const i in endorsements) {
                const endorsement = endorsements[i];
                const endorsementStr = action + ".Endorsement[" + i + "]";

                await this.results.addAsyncResult("checkNormalTransaction",
                    ResultPredicate.INVOKE,
                    { name: "VerifyIdentityMSP", value: verifyIdentityMSP },
                    { name: endorsementStr + ".Endorser.MspID", value: endorsement.endorser.Mspid },
                    { name: endorsementStr + ".Endorser.Identity", value: endorsement.endorser.IdBytes },
                    { name: configInfo.transaction + ".Config.ApplicationMSP", value: configInfo.applicationMSPs }
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
                    value: FabricPrivateRWSet.calcHash(privateRWSet.getRWSetBytes())
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
                const valueHash = FabricPrivateRWSet.calcHash(privWrite.value.toBuffer());

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
