/*
 * Copyright 2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:no-console

import { AppTransaction, AppTransactionCheckLogic, CheckPlugin,
         FabricFunctionInfo, FabricTransaction } from "..";
import { BCVerifierNotFound } from "../common";

export default class FabCarChecker extends CheckPlugin implements AppTransactionCheckLogic {
    public async probeTransactionCheck(appTx: AppTransaction): Promise<boolean> {
        // Check if the transaction is a Hyperledger Fabric one
        if (!(appTx.getTransaction() instanceof FabricTransaction)) {
            return false;
        }
        const fabricTx = appTx.getTransaction() as FabricTransaction;
        const action = fabricTx.getActions()[0];
        // Check if the transaction is a normal one (not config transaction) and contains some action
        if (fabricTx.getTransactionTypeString() !== "ENDORSER_TRANSACTION" || action == null) {
            return false;
        }
        const func = action.getFunction();
        if (func == null || func.ccName !== "fabcar") {
            return false;
        }

        return true;
    }

    public async performTransactionCheck(appTx: AppTransaction): Promise<void> {
        const fabricTx = appTx.getTransaction() as FabricTransaction;
        const action = fabricTx.getActions()[0];
        const func = action.getFunction() as FabricFunctionInfo;
        const funcNameStr = func.funcName.toString();

        if (funcNameStr === "createCar") {
            // createCar(key, make, model, color, owner)
            const writeSet = fabricTx.getWriteSet();
            const values = writeSet.filter((pair) => pair.key.toString().startsWith("fabcar\0"));

            if (values.length !== 1) {
                console.error("ERROR: CreateCar should not write to more than one key");
                console.debug("  Tx %s writes to keys %s", fabricTx.getTransactionID(),
                              values.map((k) => k.key.toString()).join(","));
            } else {
                const v = values[0];
                if (v.key.toString() !== "fabcar\0" + func.args[0].toString()) {
                    console.error("ERROR: CreateCar should not write to other key than %s", func.args[0].toString());
                } else {
                    const state = appTx.getState();

                    try {
                        state.getValue(v.key);
                        console.error("ERROR: CreateCar should not overwrite the existing car");
                    } catch (e) {
                        if (e instanceof BCVerifierNotFound) {
                            console.log("INFO: Transaction %s: createCar is ok", fabricTx.getTransactionID());
                        } else {
                            console.error("ERROR: Error while checking: %s", e);
                        }
                    }
                }
            }
        } else if (funcNameStr === "changeCarOwner") {
            // changeCarOwner(key, newOwner)
            const writeSet = fabricTx.getWriteSet();
            const values = writeSet.filter((pair) => pair.key.toString().startsWith("fabcar\0"));

            if (values.length !== 1) {
                console.error("ERROR: changeCarOwner should not write to more than one key");
                console.debug("  Tx %s writes to keys %s", fabricTx.getTransactionID(),
                              values.map((k) => k.key.toString()).join(","));
            } else {
                const v = values[0];
                if (v.key.toString() !== "fabcar\0" + func.args[0].toString()) {
                    console.error("ERROR: changeCarOwner should not write other cars than specified.");
                    console.debug("  Tx %s writes to key %s", fabricTx.getTransactionID(), v.key.toString());
                } else if (v.isDelete === true) {
                    console.error("ERROR: changeCarOwner should not delete the key");
                } else {
                    const newCar = JSON.parse(v.value.toString());

                    if (newCar.owner !== func.args[1].toString()) {
                        console.error("ERROR: changeCarOwner changes the owner to another person: %s", newCar.owner);
                    } else {
                        console.log("INFO: Transaction %s: changeCarOwner is ok", fabricTx.getTransactionID());
                    }
                }
            }
        }
    }
}
