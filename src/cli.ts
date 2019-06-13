#!/usr/bin/env node
/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:no-console

import commander from "commander";
import { writeFileSync } from "fs";
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

commander.version("v0.1.2")
    .description("Blockchain Verifier CLI")
    .option("-n, --network-type <type>", "Network type")
    .option("-c, --network-config <config>", "Config for network")
    .option("-o, --output <result file>", "Result file")
    .option("-k, --checkers <checkers>", "Checker module list", list)
    .arguments("<command>")
    .action((command) => {
        cliCommand = command;
    })
    .parse(process.argv);

if (cliCommand == null || CLI_COMMANDS[cliCommand] == null) {
    console.error("ERROR: Command is not specified or unknown.");
    commander.outputHelp();
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
    if (commander.networkType == null || commander.networkConfig == null) {
        console.error("ERROR: Network type and config must be specified.");
        commander.outputHelp();
        process.exit(1);
    }
    let applicationCheckers = [];
    if (commander.checkers != null) {
        applicationCheckers = commander.checkers;
    }

    const bcv = new BCVerifier({
        networkType: commander.networkType,
        networkConfig: commander.networkConfig,
        applicationCheckers: applicationCheckers
    });

    const resultSet = await bcv.verify();

    if (commander.output) {
        const json = new JSONOutput();
        console.log("Output the result to %s", commander.output);

        const buf = await json.convertResult(resultSet);
        writeFileSync(commander.output, buf);
    }

    const resultSummary = resultSet.getSummary();
    console.log("Checked by %s", commander.networkType);
    console.log("  Config: %s", commander.networkConfig);
    console.log("");
    console.log("Blocks:");
    console.log("  Block Range: Block %d to Block %d", resultSummary.blockRange.start, resultSummary.blockRange.end);
    console.log("");
    console.log("  Checks performed: %d (%d blocks)", resultSummary.blockChecks.total, resultSummary.blocks.total);
    console.log("  Checks passed:    %d (%d blocks)", resultSummary.blockChecks.passed, resultSummary.blocks.passed);
    console.log("  Checks failed:    %d (%d blocks)", resultSummary.blockChecks.failed, resultSummary.blocks.failed);
    console.log("");
    console.log("Transactions:");
    console.log("  Checks performed: %d (%d transactions)",
                resultSummary.transactionChecks.total, resultSummary.transactions.total);
    console.log("  Checks passed:    %d (%d transactions)",
                resultSummary.transactionChecks.total, resultSummary.transactions.total);
    console.log("  Checks failed:    %d (%d transactions)",
                resultSummary.transactionChecks.failed, resultSummary.transactions.failed);
    console.log("");

    if (resultSummary.blockChecks.failed === 0 && resultSummary.transactionChecks.failed === 0) {
        console.log("All checks finished successfully.");
        return 0;
    } else {
        console.log("Some checks failed.");
        return 2;
    }
}
