/*
 * Copyright 2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-console */

import { AppTransaction, AppTransactionCheckLogic, CheckPlugin,
         FabricFunctionInfo, FabricTransaction, ResultSet } from "..";
import { BCVerifierNotFound, ResultCode, ResultPredicate } from "../common";

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

    public async performTransactionCheck(appTx: AppTransaction, resultSet: ResultSet): Promise<void> {
        const fabricTx = appTx.getTransaction() as FabricTransaction;
        const action = fabricTx.getActions()[0];
        const func = action.getFunction() as FabricFunctionInfo;
        const funcNameStr = func.funcName.toString();

        if (funcNameStr === "createCar") {
            // createCar(key, make, model, color, owner)
            const CHECKER_ID = "fabcar-createCar-checker";

            const writeSet = fabricTx.getWriteSet();
            const values = writeSet.filter((pair) => pair.key.toString().startsWith("fabcar\0"));

            if (values.length !== 1) {
                resultSet.pushTransactionResult(fabricTx, {
                    checkerID: CHECKER_ID,
                    result: ResultCode.ERROR,
                    predicate: ResultPredicate.EQ,
                    operands: [ { name: fabricTx.toString() + ".WriteSet.length", value: values.length },
                        { name: "1", value: 1 } ]
                });
                console.error("ERROR: CreateCar should not write to more than one key");
                console.debug("  Tx %s writes to keys %s", fabricTx.getTransactionID(),
                              values.map((k) => k.key.toString()).join(","));
            } else {
                resultSet.pushTransactionResult(fabricTx, {
                    checkerID: CHECKER_ID,
                    result: ResultCode.OK,
                    predicate: ResultPredicate.EQ,
                    operands: [ { name: fabricTx.toString() + ".WriteSet.length", value: values.length },
                        { name: "1", value: 1 } ]
                });

                const v = values[0];
                if (v.key.toString() !== "fabcar\0" + func.args[0].toString()) {
                    resultSet.pushTransactionResult(fabricTx, {
                        checkerID: CHECKER_ID,
                        result: ResultCode.ERROR,
                        predicate: ResultPredicate.EQ,
                        operands: [ { name: fabricTx.toString() + ".WriteSet[0].key", value: v.key.toString() },
                            { name: "fabcar\0" + func.args[0].toString(),
                              value: "fabcar\0" + func.args[0].toString() } ]
                    });
                    console.error("ERROR: CreateCar should not write to other key than %s", func.args[0].toString());
                } else {
                    resultSet.pushTransactionResult(fabricTx, {
                        checkerID: CHECKER_ID,
                        result: ResultCode.OK,
                        predicate: ResultPredicate.EQ,
                        operands: [ { name: fabricTx.toString() + ".WriteSet[0].key", value: v.key.toString() },
                            { name: "fabcar\0" + func.args[0].toString(),
                              value: "fabcar\0" + func.args[0].toString() } ]
                    });

                    const state = appTx.getState();

                    try {
                        state.getValue(v.key);
                        console.error("ERROR: CreateCar should not overwrite the existing car");

                        resultSet.pushTransactionResult(fabricTx, {
                            checkerID: CHECKER_ID,
                            result: ResultCode.ERROR,
                            predicate: ResultPredicate.INVOKE,
                            operands: [ { name: "getValue(" + v.key + ")", value: v.key.toString() } ]
                        });
                    } catch (e) {
                        if (e instanceof BCVerifierNotFound) {
                            resultSet.pushTransactionResult(fabricTx, {
                                checkerID: CHECKER_ID,
                                result: ResultCode.OK,
                                predicate: ResultPredicate.INVOKE,
                                operands: [ { name: "getValue(" + v.key + ")", value: v.key.toString() } ]
                            });
                            console.log("INFO: Transaction %s: createCar is ok", fabricTx.getTransactionID());
                        } else {
                            console.error("ERROR: Error while checking: %s", e);
                        }
                    }
                }
            }
        } else if (funcNameStr === "changeCarOwner") {
            // changeCarOwner(key, newOwner)
            const CHECKER_ID = "fabcar-changeCarOwner-checker";

            const writeSet = fabricTx.getWriteSet();
            const values = writeSet.filter((pair) => pair.key.toString().startsWith("fabcar\0"));

            if (values.length !== 1) {
                resultSet.pushTransactionResult(fabricTx, {
                    checkerID: CHECKER_ID,
                    result: ResultCode.ERROR,
                    predicate: ResultPredicate.EQ,
                    operands: [ { name: fabricTx.toString() + ".WriteSet.length", value: values.length },
                        { name: "1", value: 1 } ]
                });

                console.error("ERROR: changeCarOwner should not write to more than one key");
                console.debug("  Tx %s writes to keys %s", fabricTx.getTransactionID(),
                              values.map((k) => k.key.toString()).join(","));
            } else {
                resultSet.pushTransactionResult(fabricTx, {
                    checkerID: CHECKER_ID,
                    result: ResultCode.OK,
                    predicate: ResultPredicate.EQ,
                    operands: [ { name: fabricTx.toString() + ".WriteSet.length", value: values.length },
                        { name: "1", value: 1 } ]
                });

                const v = values[0];
                if (v.key.toString() !== "fabcar\0" + func.args[0].toString()) {
                    resultSet.pushTransactionResult(fabricTx, {
                        checkerID: CHECKER_ID,
                        result: ResultCode.ERROR,
                        predicate: ResultPredicate.EQ,
                        operands: [ { name: fabricTx.toString() + ".WriteSet[0].key", value: v.key.toString() },
                            { name: "fabcar\0" + func.args[0].toString(),
                              value: "fabcar\0" + func.args[0].toString() } ]
                    });

                    console.error("ERROR: changeCarOwner should not write other cars than specified.");
                    console.debug("  Tx %s writes to key %s", fabricTx.getTransactionID(), v.key.toString());
                } else {
                    resultSet.pushTransactionResult(fabricTx, {
                        checkerID: CHECKER_ID,
                        result: ResultCode.OK,
                        predicate: ResultPredicate.EQ,
                        operands: [ { name: fabricTx.toString() + ".WriteSet[0].key", value: v.key.toString() },
                            { name: "fabcar\0" + func.args[0].toString(),
                              value: "fabcar\0" + func.args[0].toString() } ]
                    });

                    if (v.isDelete === true) {
                        resultSet.pushTransactionResult(fabricTx, {
                            checkerID: CHECKER_ID,
                            result: ResultCode.ERROR,
                            predicate: ResultPredicate.EQ,
                            operands: [ { name: fabricTx.toString() + ".WriteSet[0].isDelete", value: v.isDelete },
                                { name: "true", value: true } ]
                        });

                        console.error("ERROR: changeCarOwner should not delete the key");
                    } else {
                        resultSet.pushTransactionResult(fabricTx, {
                            checkerID: CHECKER_ID,
                            result: ResultCode.OK,
                            predicate: ResultPredicate.EQ,
                            operands: [ { name: fabricTx.toString() + ".WriteSet[0].isDelete", value: v.isDelete },
                                { name: "true", value: true } ]
                        });

                        const newCar = JSON.parse(v.value.toString());

                        if (newCar.owner !== func.args[1].toString()) {
                            resultSet.pushTransactionResult(fabricTx, {
                                checkerID: CHECKER_ID,
                                result: ResultCode.ERROR,
                                predicate: ResultPredicate.EQ,
                                operands: [ { name: fabricTx.toString() + ".WriteSet[0].value.owner",
                                              value: v.key.toString() },
                                { name: func.args[1].toString(),
                                  value: func.args[1].toString() } ]
                            });

                            console.error("ERROR: changeCarOwner changes the owner to another person: %s",
                                          newCar.owner);
                        } else {
                            resultSet.pushTransactionResult(fabricTx, {
                                checkerID: CHECKER_ID,
                                result: ResultCode.OK,
                                predicate: ResultPredicate.EQ,
                                operands: [ { name: fabricTx.toString() + ".WriteSet[0].value.owner",
                                              value: v.key.toString() },
                                { name: func.args[1].toString(),
                                  value: func.args[1].toString() } ]
                            });

                            console.log("INFO: Transaction %s: changeCarOwner is ok", fabricTx.getTransactionID());
                        }
                    }
                }
            }
        }
    }
}
