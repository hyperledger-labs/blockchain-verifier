/*
 * Copyright 2021 Hitachi, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, ExecFileSyncOptionsWithStringEncoding } from "child_process";
import fs from "fs";
import path from "path";

function helperScriptPath(scriptName: string) {
    return path.join(__dirname, scriptName);
}
function cliPath() {
    return path.join(__dirname, "..", "build", "cli.js");
}
function artifactDir(peerName: string) {
    return path.join(__dirname, "artifacts", peerName);
}
function mspDir(orgName: string) {
    return path.join(__dirname, "fabric-samples", "test-network", "organizations", "peerOrganizations", orgName, "msp");
}
function mspAdminDir(orgName: string) {
    return path.join(__dirname, "fabric-samples", "test-network", "organizations", "peerOrganizations", orgName, "users", "Admin@" + orgName, "msp");
}
function findKeyFile(dir: string) {
    const file = fs.readdirSync(dir).find((f) => f.endsWith("_sk"));

    if (file == null) {
        throw new Error("No private key found in " + dir);
    }
    return path.join(dir, file);
}
function shouldPrepareFabric() {
    return process.env["BCV_IT_NO_NEW_NETWORK"] == null;
}

const execOptions: ExecFileSyncOptionsWithStringEncoding = {
    stdio: ["ignore", "inherit", "inherit"],
    encoding: "utf-8"
};
const versionCombinations: {[version: string]: string[]} = {
    "2.2": ["2.2.9", "1.5.5"],
    "2.4": ["2.4.9", "1.5.5"],
    "2.5": ["2.5.0-beta", "1.5.5"]
};

const FABRIC_LEDGER_PATH = ["ledgersData", "chains", "chains"];
const FABRIC_PRIVDATA_PATH = ["ledgersData", "pvtdataStore"];

const fabricBlockConfig = [{
    name: "peer0.org1.example.com",
    ledgerStore: path.join(artifactDir("peer0.org1.example.com"), ...FABRIC_LEDGER_PATH, "mychannel"),
    privateDataStore: path.join(artifactDir("peer0.org1.example.com"), ...FABRIC_PRIVDATA_PATH)
}, {
    name: "peer0.org2.example.com",
    ledgerStore: path.join(artifactDir("peer0.org2.example.com"), ...FABRIC_LEDGER_PATH, "mychannel"),
    privateDataStore: path.join(artifactDir("peer0.org2.example.com"), ...FABRIC_PRIVDATA_PATH)
}];

const fabricQueryPeerConfigs = [{
    url: "grpcs://localhost:7051",
    mspID: "Org1MSP",
    tlsCACertFile: path.join(mspDir("org1.example.com"), "tlscacerts", "ca.crt")
}, {
    url: "grpcs://localhost:9051",
    mspID: "Org2MSP",
    tlsCACertFile: path.join(mspDir("org2.example.com"), "tlscacerts", "ca.crt")
}];

const fabricQueryConfig = {
    channel: "mychannel",
    client: {
        certFile: path.join(mspAdminDir("org1.example.com"), "signcerts", "cert.pem"),
        keyFile: "TO_BE_FILLED",
        mspID: "Org1MSP"
    },
    config: {
        useDiscovery: false
    }
};

interface CountResult {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
}
enum CheckTarget {
    Block,
    Transaction
}

function countResults(results: any, target?: CheckTarget, checkerID?: string): CountResult {
    const count: CountResult = {
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0
    };

    if (target == null || target === CheckTarget.Block) {
        for (const b of results.blocks) {
            for (const r of b.results) {
                if (checkerID == null || r.checkerID === checkerID) {
                    count.total++;
                    if (r.result === "OK") {
                        count.successful++;
                    } else if (r.result === "SKIPPED") {
                        count.skipped++;
                    } else {
                        count.failed++;
                    }
                }
            }
        }
    }
    if (target == null || target === CheckTarget.Transaction) {
        for (const tx of results.transactions) {
            for (const r of tx.results) {
                if (checkerID == null || r.checkerID === checkerID) {
                    count.total++;
                    if (r.result === "OK") {
                        count.successful++;
                    } else if (r.result === "SKIPPED") {
                        count.skipped++;
                    } else {
                        count.failed++;
                    }
                }
            }
        }
    }

    return count;
}

const CHECKER_ID_BLOCK_HASH_COMPARISON = "GenericMultipleLedgerBlockPlugin.blockHashComparisonWithOtherSource";

async function startNetworkV22(version: string) {
    if (shouldPrepareFabric()) {
        try {
            execFileSync(helperScriptPath("cleanup.sh"), [], execOptions);
        } catch (e) {
            // Ignore
        }

        execFileSync("npm", ["run", "build"], execOptions);

        execFileSync(helperScriptPath("prepare.sh"), versionCombinations[version], {
            ...execOptions,
            env: {
                ...process.env,
                COMPOSE_PROJECT_NAME: "fabric"
            }
        });
        execFileSync(helperScriptPath("basic.sh"), [], execOptions);
        execFileSync(helperScriptPath("copy-files.sh"), [], execOptions);
    }

    fabricQueryConfig.client.keyFile = findKeyFile(path.join(mspAdminDir("org1.example.com"), "keystore"));
}

async function startNetworkV24(version: string) {
    if (shouldPrepareFabric()) {
        try {
            execFileSync(helperScriptPath("cleanup.sh"), [], execOptions);
        } catch (e) {
            // Ignore
        }

        execFileSync("npm", ["run", "build"], execOptions);

        execFileSync(helperScriptPath("prepare.sh"), versionCombinations[version], execOptions);
        execFileSync(helperScriptPath("basic.sh"), [], execOptions);
        execFileSync(helperScriptPath("copy-files.sh"), [], execOptions);
    }

    fabricQueryConfig.client.keyFile = findKeyFile(path.join(mspAdminDir("org1.example.com"), "keystore"));
}

type TestConfig = {
    version: string;
    startNetwork: (version: string) => Promise<void>;
}

describe.each<TestConfig>([
    { version: "2.2", startNetwork: startNetworkV22 },
    { version: "2.4", startNetwork: startNetworkV24 },
    { version: "2.5", startNetwork: startNetworkV24 }
])("Hyperledger Fabric $version", ({version, startNetwork}) => {

    beforeAll(async () => {
        await startNetwork(version);
    });

    afterAll(async() => {
        if (shouldPrepareFabric()) {
            try {
                execFileSync(helperScriptPath("cleanup.sh"), [], execOptions);
            } catch (e) {
                // Ignore
            }
        }
    });

    test("fabric-block for a single block file runs successfully", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-block.json");

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-block",
                    "-c", path.join(fabricBlockConfig[0].ledgerStore, "blockfile_000000"),
                    "-o", resultJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
    });

    test("fabric-block with a block config runs successfully", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-block-config.json");
        const blockConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-block-config.json");

        fs.writeFileSync(blockConfigJSON, JSON.stringify([fabricBlockConfig[0]]));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-block",
                    "-c", blockConfigJSON,
                    "-o", resultJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
    });

    test("fabric-block with a block config for multiple peers runs successfully", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-block-config-multiple-peers.json");
        const blockConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-block-config-multiple-peers.json");

        fs.writeFileSync(blockConfigJSON, JSON.stringify(fabricBlockConfig));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-block",
                    "-c", blockConfigJSON,
                    "-o", resultJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        expect(countResults(results, CheckTarget.Block, CHECKER_ID_BLOCK_HASH_COMPARISON).total).toBeGreaterThan(0);
    });

    test("fabric-query2 runs successfully", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
    });

    test("fabric-query2 with multiple peers runs successfully", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query-multiple-peers.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-multiple-peers-config.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peers: fabricQueryPeerConfigs
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);

        expect(countResults(results, CheckTarget.Block, CHECKER_ID_BLOCK_HASH_COMPARISON).total).toBeGreaterThan(0);
    });

    /* Testing checkpoint feature */
    test("fabric-query2 runs successfully with saving checkpoint up to block #5", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.checkpoint5.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block5.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-s", checkpointJSON,
                    "-e", "5"
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check only blocks #0 through #5
        expect(results.blocks).toHaveLength(6);

        const checkpoint = JSON.parse(fs.readFileSync(checkpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(5);
        expect(checkpoint.stateInformation).toHaveLength(5);
    });

    test("fabric-query2 runs successfully by resuming from checkpoint at block #5", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.resume.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block5.json");
        const newCheckpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block7.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-r", checkpointJSON,
                    "-s", newCheckpointJSON
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check only blocks #6 through #9
        expect(results.blocks).toHaveLength(4);

        const checkpoint = JSON.parse(fs.readFileSync(newCheckpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(9);
        expect(checkpoint.stateInformation).toHaveLength(12);
    });

    test("fabric-query2 checks one block successfully by resuming from checkpoint at block #5 with '-b 1' option", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.resume.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block5.json");
        const newCheckpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block6.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-r", checkpointJSON,
                    "-s", newCheckpointJSON,
                    "-b", "1"
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check only the block #6
        expect(results.blocks).toHaveLength(1);

        const checkpoint = JSON.parse(fs.readFileSync(newCheckpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(6);
    });

    test("fabric-query2 checks up to block #7 by resuming from checkpoint at block #5 with '-b 999' option", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.resume.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block5.json");
        const newCheckpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block6.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-r", checkpointJSON,
                    "-s", newCheckpointJSON,
                    "-b", "999"
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check only the block #6 through #9
        expect(results.blocks).toHaveLength(4);

        const checkpoint = JSON.parse(fs.readFileSync(newCheckpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(9);
    });

    test("fabric-query2 runs successfully with saving checkpoint up to block #6 w/o state information", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.checkpoint6.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block6.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-s", checkpointJSON,
                    "-e", "6",
                    "-i"
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check only blocks #0 through #6
        expect(results.blocks).toHaveLength(7);

        const checkpoint = JSON.parse(fs.readFileSync(checkpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(6);
        expect(checkpoint).not.toHaveProperty("stateInformation");
    });

    test("fabric-query2 runs successfully by resuming from checkpoint at block #6 w/o state information", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.resume.wostate.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block6.json");
        const newCheckpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block7.wostate.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-r", checkpointJSON,
                    "-s", newCheckpointJSON,
                    "-i"
                ], execOptions);
        }).not.toThrow();

        const results = JSON.parse(fs.readFileSync(resultJSON).toString("utf-8"));
        const allCount = countResults(results);

        expect(allCount.total).toBeGreaterThan(0);
        expect(allCount.failed).toBe(0);
        // Should check blocks #7 through #9
        expect(results.blocks).toHaveLength(3);

        const checkpoint = JSON.parse(fs.readFileSync(newCheckpointJSON).toString("utf-8"));
        expect(checkpoint.lastBlock).toBe(9);
        expect(checkpoint).not.toHaveProperty("stateInformation");
    });

    test("fabric-query2 w/o '-i' option fails by resuming from checkpoint at block #6 w/o state information", async () => {
        const resultJSON = path.join(artifactDir("peer0.org1.example.com"), "result.fabric-query.resume.wostate.json");
        const queryConfigJSON = path.join(artifactDir("peer0.org1.example.com"), "fabric-query-config.json");
        const checkpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block6.json");
        const newCheckpointJSON = path.join(artifactDir("peer0.org1.example.com"), "checkpoint.fabric-query.block7.wostate.json");

        fs.writeFileSync(queryConfigJSON, JSON.stringify({
            ...fabricQueryConfig,
            peer: fabricQueryPeerConfigs[0]
        }));

        expect(() => {
            execFileSync(cliPath(),
                [
                    "start",
                    "-n", "fabric-query2",
                    "-c", queryConfigJSON,
                    "-o", resultJSON,
                    "-r", checkpointJSON,
                    "-s", newCheckpointJSON
                ], execOptions);
        }).toThrow();
    });
});
