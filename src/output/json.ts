/*
 * Copyright 2018 Hitachi America, Ltd. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { format } from "util";

import { OutputPlugin } from ".";
import { BCVerifierError, CheckResult, ResultCode } from "../common";
import { ResultSet } from "../result-set";

type JSONableCheckResult = {
    checkerID: string;
    result: string;
    predicate?: string;
    operands?: string[];
    skipReason?: string;
};

type JSONableBlockResult = {
    number: number;
    results: JSONableCheckResult[];
};

type JSONableTransactionResult = {
    id: string;
    blockNumber: number;
    results: JSONableCheckResult[];
};

type JSONableResultSet = {
    blocks: JSONableBlockResult[];
    transactions: JSONableTransactionResult[];
};

const resultToStr = {
    0 : "OK",
    1 : "ERROR",
    2 : "SKIPPED",
};
const predicateToStr = {
    0: "EQ",
    1: "EQ",
    2: "INVOKE",
    3: "LT",
    4: "LE",
    5: "GT",
    6: "GE",
};

function resultToJSONable(r: CheckResult): JSONableCheckResult {
    if (r.result === ResultCode.OK || r.result === ResultCode.ERROR) {
        return {
            checkerID: r.checkerID,
            result: resultToStr[r.result],
            predicate: predicateToStr[r.predicate],
            operands: r.operands.map((o) => o.name)
        };
    } else if (r.result === ResultCode.SKIPPED) {
        return {
            checkerID: r.checkerID,
            result: resultToStr[r.result],
            skipReason: r.skipReason
        };
    } else {
        throw new BCVerifierError(format("Unexpected result code : %d", r.result));
    }
}

function convertResultToJSONable(resultSet: ResultSet): JSONableResultSet {
    return {
        blocks: resultSet.getBlockResults().map((r) => {
            return {
                number: r.number,
                results: r.results.map((res) => resultToJSONable(res))
            };
        }),
        transactions: resultSet.getTransactionResults().map((r) => {
            return {
                id: r.transactionID,
                blockNumber: r.blockNumber,
                results: r.results.map((res) => resultToJSONable(res))
            };
        })
    };
}

export class JSONOutput implements OutputPlugin {
    public async convertResult(resultSet: ResultSet): Promise<Buffer> {
        const resultObj = convertResultToJSONable(resultSet);

        return Buffer.from(JSON.stringify(resultObj));
    }
}
