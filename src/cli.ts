#!/usr/bin/env node
/*
 * Copyright 2018-2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable no-console */

import { Command } from "commander";
import { readFileSync, writeFileSync } from "fs";
import { BCVerifier } from "./bcverifier";
import { BCVerifierError } from "./common";
import { JSONOutput } from "./output/json";

let cliCommand: string | null = null;

const CLI_COMMANDS: { [commandName: string]: () => Promise<number> } = {
    start : start
};

function list(val: string): string[] {
    return val.split(",");
}

const program = new Command();

program.version("v0.4.0")
    .description("Blockchain Verifier CLI")
    .option("-n, --network-type <type>", "Network type")
    .option("-c, --network-config <config>", "Config for network")
    .option("-o, --output <result file>", "Result file")
    .option("-k, --checkers <checkers>", "Checker module list", list)
    .option("-x, --exclude-checkers <checkers>", "Name of checkers to exclude", list)
    .option("-s, --save-checkpoint <checkpoint>", "Save checkpoint after checks")
    .option("-r, --resume-checkpoint <checkpoint>", "Resume checks from checkpoint")
    .option("-e, --end-block <end block>", "Stop the checks at the specified block (inclusive)")
    .option("-b, --check-block-count <check block count>", "Maximum number of blocks to be checked")
    .option("-i, --skip-key-value", "Skip key value processing even if checkpoint is specified")
    .arguments("<command>")
    .action((command) => {
        cliCommand = command;
    })
    .parse(process.argv);

if (cliCommand == null || CLI_COMMANDS[cliCommand] == null) {
    console.error("ERROR: Command is not specified or unknown.");
    program.outputHelp();
    process.exit(1);
} else {
    CLI_COMMANDS[cliCommand]()
        .then((retCode) => {
            process.exit(retCode);
        })
        .catch((error) => {
            if (error instanceof BCVerifierError) {
                console.error("BCVerifier Error: %s", error.message);
                console.error(error.stack);
            } else if (error instanceof Error) {
                console.error("Runtime Error: (%s) %s", error.name, error.message);
                console.error(error.stack);
            } else {
                console.error("Exception during execution: %s", error);
            }
            process.exit(1);
        });
}

async function start(): Promise<number> {
    const opts = program.opts();
    if (opts.networkType == null || opts.networkConfig == null) {
        console.error("ERROR: Network type and config must be specified.");
        program.outputHelp();
        process.exit(1);
    }
    let applicationCheckers = [];
    if (opts.checkers != null) {
        applicationCheckers = opts.checkers;
    }
    let checkersToExclude = [];
    if (opts.excludeCheckers != null) {
        checkersToExclude = opts.excludeCheckers;
    }
    const saveCheckpoint = opts.saveCheckpoint == null ? false : true;
    let resumeData;
    if (opts.resumeCheckpoint != null) {
        resumeData = JSON.parse(readFileSync(opts.resumeCheckpoint).toString("utf-8"));
    }

    const bcv = new BCVerifier({
        networkType: opts.networkType,
        networkConfig: opts.networkConfig,
        applicationCheckers: applicationCheckers,
        checkersToExclude: checkersToExclude,
        saveCheckpoint: saveCheckpoint,
        checkpointToResume: resumeData,
        endBlock: opts.endBlock == null ? undefined : parseInt(opts.endBlock),
        skipKeyValue: opts.skipKeyValue,
        checkBlockCount: opts.checkBlockCount == null ? undefined : parseInt(opts.checkBlockCount)
    });

    const { resultSet, checkpointData } = await bcv.verify();

    if (saveCheckpoint) {
        if (checkpointData == null) {
            console.warn("Checkpoint is not generated. Skipping saving the checkpoint...");
        } else {
            writeFileSync(opts.saveCheckpoint, JSON.stringify(checkpointData));
        }
    }

    if (opts.output) {
        const json = new JSONOutput();
        console.log("Output the result to %s", opts.output);

        const buf = await json.convertResult(resultSet);
        writeFileSync(opts.output, buf);
    }

    const resultSummary = resultSet.getSummary();
    console.log("Checked by %s", opts.networkType);
    console.log("  Config: %s", opts.networkConfig);
    console.log("");
    console.log("Blocks:");
    console.log("  Block Range: Block %d to Block %d", resultSummary.blockRange.start, resultSummary.blockRange.end);
    console.log("");
    console.log("  Checks performed: %d (%d blocks)", resultSummary.blockChecks.total, resultSummary.blocks.total);
    console.log("  Checks passed:    %d (%d blocks)", resultSummary.blockChecks.passed, resultSummary.blocks.passed);
    console.log("  Checks failed:    %d (%d blocks)", resultSummary.blockChecks.failed, resultSummary.blocks.failed);
    console.log("  Checks skipped:   %d            ", resultSummary.blockChecks.skipped);
    console.log("");
    console.log("Transactions:");
    console.log("  Checks performed: %d (%d transactions)",
                resultSummary.transactionChecks.total, resultSummary.transactions.total);
    console.log("  Checks passed:    %d (%d transactions)",
                resultSummary.transactionChecks.passed, resultSummary.transactions.passed);
    console.log("  Checks failed:    %d (%d transactions)",
                resultSummary.transactionChecks.failed, resultSummary.transactions.failed);
    console.log("  Checks skipped:   %d                  ", resultSummary.transactionChecks.skipped);
    console.log("");
    console.log("States:");
    console.log("  Checks performed: %d", resultSummary.stateChecks.total);
    console.log("  Checks passed:    %d", resultSummary.stateChecks.passed);
    console.log("  Checks failed:    %d", resultSummary.stateChecks.failed);
    console.log("  Checks skipped:   %d", resultSummary.stateChecks.skipped);
    console.log("");

    if (resultSummary.blockChecks.failed === 0 && resultSummary.transactionChecks.failed === 0 &&
        resultSummary.stateChecks.failed === 0) {
        console.log("All checks finished successfully.");
        return 0;
    } else {
        console.log("Some checks failed.");
        return 2;
    }
}
