/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BCVerifierError, Block, BlockResult, CheckResult,
         ResultCode, ResultOperand, ResultPredicate, StateResult, Transaction, TransactionResult } from "./common";

function evaluate(predicate: ResultPredicate, values: ResultOperand[]): boolean {
    const v = values[0];

    switch (predicate) {
        case ResultPredicate.EQ:
            for (let i = 1; i < values.length; i++) {
                if (v.value !== values[i].value) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.EQBIN:
            for (let i = 1; i < values.length; i++) {
                if (!v.value.equals(values[i].value)) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.LT:
            for (let i = 1; i < values.length; i++) {
                if (!(values[i - 1].value < values[i].value)) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.LE:
            for (let i = 1; i < values.length; i++) {
                if (!(values[i - 1].value <= values[i].value)) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.GT:
            for (let i = 1; i < values.length; i++) {
                if (!(values[i - 1].value > values[i].value)) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.GE:
            for (let i = 1; i < values.length; i++) {
                if (!(values[i - 1].value >= values[i].value)) {
                    return false;
                }
            }
            return true;
        case ResultPredicate.INVOKE:
            return v.value(...values.slice(1).map((op) => op.value));
    }
}

export class BlockResultPusher {
    private block: Block | null;
    private pluginName: string;
    private resultSet: ResultSet;

    constructor(pluginName: string, resultSet: ResultSet) {
        this.block = null;
        this.pluginName = pluginName;
        this.resultSet = resultSet;
    }

    public setBlock(block: Block) {
        this.block = block;
    }

    public addResult(functionName: string, predicate: ResultPredicate, ...values: ResultOperand[]): boolean {
        if (this.block == null) {
            throw new BCVerifierError("No block set for result");
        }
        const result = evaluate(predicate, values);

        this.resultSet.pushBlockResult(this.block, {
            checkerID: this.pluginName + "." + functionName,
            result: result ? ResultCode.OK : ResultCode.ERROR,
            predicate: predicate,
            operands: values
        });

        return result;
    }

    public async addAsyncResult(functionName: string, predicate: ResultPredicate.INVOKE,
                                ...values: ResultOperand[]): Promise<boolean> {
        if (this.block == null) {
            throw new BCVerifierError("No block set for result");
        }
        const result = await evaluate(predicate, values);

        this.resultSet.pushBlockResult(this.block, {
            checkerID: this.pluginName + "." + functionName,
            result: result ? ResultCode.OK : ResultCode.ERROR,
            predicate: predicate,
            operands: values
        });
        return result;
    }

    public addSkipResult(functionName: string, reason: string): void {
        if (this.block == null) {
            throw new BCVerifierError("No block set for result");
        }
        this.resultSet.pushBlockResult(this.block, {
            checkerID: this.pluginName + "." + functionName,
            result: ResultCode.SKIPPED,
            skipReason: reason
        });
    }
}

export class TransactionResultPusher {
    private transaction: Transaction | null;
    private pluginName: string;
    private resultSet: ResultSet;

    constructor(pluginName: string, resultSet: ResultSet) {
        this.transaction = null;
        this.pluginName = pluginName;
        this.resultSet = resultSet;
    }

    public setTransaction(transaction: Transaction) {
        this.transaction = transaction;
    }

    public addResult(functionName: string, predicate: ResultPredicate, ...values: ResultOperand[]): boolean {
        if (this.transaction == null) {
            throw new BCVerifierError("No transaction set for result");
        }

        const result = evaluate(predicate, values);

        this.resultSet.pushTransactionResult(this.transaction, {
            checkerID: this.pluginName + "." + functionName,
            result: result ? ResultCode.OK : ResultCode.ERROR,
            predicate: predicate,
            operands: values
        });
        return result;
    }

    public async addAsyncResult(functionName: string, predicate: ResultPredicate.INVOKE,
                                ...values: ResultOperand[]): Promise<boolean> {
        if (this.transaction == null) {
            throw new BCVerifierError("No transaction set for result");
        }

        const result = await evaluate(predicate, values);

        this.resultSet.pushTransactionResult(this.transaction, {
            checkerID: this.pluginName + "." + functionName,
            result: result ? ResultCode.OK : ResultCode.ERROR,
            predicate: predicate,
            operands: values
        });
        return result;
    }

    public addSkipResult(functionName: string, reason: string): void {
        if (this.transaction == null) {
            throw new BCVerifierError("No transaction set for result");
        }
        this.resultSet.pushTransactionResult(this.transaction, {
            checkerID: this.pluginName + "." + functionName,
            result: ResultCode.SKIPPED,
            skipReason: reason
        });
    }
}

export class CheckCount {
    public total: number;
    public passed: number;
    public failed: number;
    public skipped: number;

    constructor() {
        this.total = 0;
        this.passed = 0;
        this.failed = 0;
        this.skipped = 0;
    }

    public add(newCount: CheckCount) {
        this.total += newCount.total;
        this.passed += newCount.passed;
        this.failed += newCount.failed;
        this.skipped += newCount.skipped;
    }
}

export type CheckSummary = {
    blocks: CheckCount;
    blockChecks: CheckCount;
    transactions: CheckCount;
    transactionChecks: CheckCount;
    stateChecks: CheckCount;

    blockRange: { start: number, end: number };
};

export class ResultSet {
    private blocks: { [blockNumber: number]: BlockResult };
    private transactions: { [transactionID: string]: TransactionResult };
    private state: StateResult;

    constructor() {
        this.blocks = {};
        this.transactions = {};
        this.state = {
            results: []
        };
    }

    public getBlockResults(): BlockResult[] {
        const results: BlockResult[] = [];

        for (const num in this.blocks) {
            results.push(this.blocks[num]);
        }

        results.sort((a, b) => (a.number - b.number));

        return results;
    }

    public getTransactionResults(): TransactionResult[] {
        const results: TransactionResult[] = [];

        for (const txid in this.transactions) {
            results.push(this.transactions[txid]);
        }

        results.sort((a, b) => {
            if (a.blockNumber === b.blockNumber) {
                return a.index - b.index;
            } else {
                return a.blockNumber - b.blockNumber;
            }
        });

        return results;
    }

    public pushBlockResult(block: Block, result: CheckResult): void {
        const blockNumber = block.getBlockNumber();
        if (this.blocks[blockNumber] == null) {
            this.blocks[blockNumber] = {
                number: blockNumber,
                block: block,
                results: []
            };
        }
        const b = this.blocks[blockNumber];
        b.results.push(result);
    }

    public pushTransactionResult(transaction: Transaction, result: CheckResult): void {
        const txID = transaction.getTransactionID();
        if (this.transactions[txID] == null) {
            this.transactions[txID] = {
                transactionID: txID,
                index: transaction.getIndexInBlock(),
                blockNumber: transaction.getBlock().getBlockNumber(),
                results: []
            };
        }
        const t = this.transactions[txID];
        t.results.push(result);
    }

    public pushStateResult(result: CheckResult): void {
        this.state.results.push(result);
    }

    public getSummary(): CheckSummary {
        let minBlock: number | null = null;
        let maxBlock: number | null = null;

        const blockChecksCount = new CheckCount();
        const blockCount = new CheckCount();
        const txChecksCount = new CheckCount();
        const txCount = new CheckCount();

        for (const blockNumber in this.blocks) {
            const block = this.blocks[blockNumber];
            const num = block.number;

            if (minBlock == null || minBlock > num) {
                minBlock = num;
            }
            if (maxBlock == null || maxBlock < num) {
                maxBlock = num;
            }

            const cc = this.countChecks(block.results);
            blockChecksCount.add(cc);
            if (cc.failed > 0) {
                blockCount.failed++;
            } else if (cc.skipped > 0 && cc.passed === 0) {
                blockCount.skipped++;
            } else {
                blockCount.passed++;
            }
            blockCount.total++;
        }
        for (const txID in this.transactions) {
            const tx = this.transactions[txID];

            const cc = this.countChecks(tx.results);
            txChecksCount.add(cc);
            if (cc.failed > 0) {
                txCount.failed++;
            } else if (cc.skipped > 0 && cc.passed === 0) {
                txCount.skipped++;
            } else {
                txCount.passed++;
            }
            txCount.total++;
        }
        if (minBlock == null) {
            minBlock = -1;
        }
        if (maxBlock == null) {
            maxBlock = -1;
        }
        const stateCount = this.countChecks(this.state.results);

        return {
            blocks: blockCount,
            blockChecks: blockChecksCount,
            transactions: txCount,
            transactionChecks: txChecksCount,
            stateChecks: stateCount,

            blockRange: { start: minBlock, end: maxBlock }
        };
    }

    protected countChecks(checkResults: CheckResult[]): CheckCount {
        const cc: CheckCount = new CheckCount();

        for (const checkResult of checkResults) {
            if (checkResult.result === ResultCode.OK) {
                cc.passed++;
            } else if (checkResult.result === ResultCode.ERROR) {
                cc.failed++;
            } else {
                cc.skipped++;
            }
            cc.total++;
        }
        return cc;
    }

}
