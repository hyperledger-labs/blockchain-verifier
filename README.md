# Blockchain Verifier

## Overview

The goal of this tool is to verify the integrity of blockchain blocks and transactions.

## Supported Blockchain Platforms

- Hyperledger Fabric v2.2 & v2.4
- Hyperledger Fabric v2.5 (experimental, only tested with beta)

## Prerequisites

- Node.js >= v16

## Install

```
$ npm install blockchain-verifier
```

## Usage

```
$ npx bcverifier -n (Network plugin) -c (Network config) -o (Result file) (Command)
```

Run with `-h` for the full list of the options.

### Options

| Option            | Description                                                                                        |
|-------------------|----------------------------------------------------------------------------------------------------|
| `-n (plugin)`     | Specify the name of the network plugin to use                                                      |
| `-c (config)`     | Configuration passed to the network plugin. See the description for the network plugins for detail |
| `-o (file)`       | Save the result JSON in the specified file                                                         |
| `-k (checkers)`   | Specify the modules to use as application-specific checkers                                        |
| `-x (checkers)`   | Disable the checkers with specified names                                                          |
| `-s (checkpoint)` | Save the checkpoint into a JSON file after the checks are completed                                |
| `-r (checkpoint)` | Resume checks from the checkpoint                                                                  |
| `-i`              | Skip key-value processing even if a checkpoint is to be saved (i.e. the `-s` option is specified)  |
| `-e (block)`      | Stop checks at the specified block number                                                          |

### Commands

| Command       | Description                                                 |
|---------------|-------------------------------------------------------------|
| `start`       | Start verification and save the result if `-o` is specified |

### Example

```
$ npx bcverifier -n fabric-block -c /tmp/block/blockfile_000000 -o result.json start
```

Runs verification against a Hyperledger Fabric ledger file `/tmp/block/blockfile_000000` using the `fabric-block` plugin.

## Network plugins

| Name            | Supported Platform          | Description                                | Config value (`-c` option)             |
|-----------------|-----------------------------|--------------------------------------------|----------------------------------------|
| `fabric-block`  | Hyperledger Fabric v2.x     | Verify a ledger file and private DB        | Path to the ledger file or config JSON |
| `fabric-query2` | Hyperledger Fabric v2.x     | Verify blocks by querying to a peer        | Path to the query config file          |

### fabric-block

This plugin checks a ledger file for a channel in Hyperledger Fabric network.
The file can be usually found in `/var/lib/hyperledger/production/ledgersData/chains/chains/(channel name)` in a peer.
It also supports checking of the private data (SideDB) against the ledger if the private data is available.

The configuration is either a path to a ledger file or to a configuration JSON.
If you want to check private data, use the latter (JSON).
The format for the JSON is an array of objects (only one object is supported though).
The keys for the object is as follows:

| Key name                       | Type    | Description                             |
|--------------------------------|---------|-----------------------------------------|
| `name`                         | string  | any string name for this ledger source  |
| `ledgerStore`                  | string  | path to a ledger directory              |
| `blockFile`                    | string  | path to a ledger file                   |
| `privateDataStore`             | string  | path to a private DB directory          |

Among the keys, `ledgerStore` or `blockFile` is mandatory.
The private DB can be found in `/var/lib/hyperledger/production/ledgersData/pvtdataStore` in a default configuration.
If you want to check private data, please perform check against a *copy* of the directory.
Otherwise (such as using the directory for a running Fabric peer), the tool might affect the Fabric peer.

Example:
```json
[
  {
    "name": "peer0.org1.example.com",
    "ledgerStore": "/tmp/peerLedger/ledgersData/chains/chains/mychannel",
    "privateDataStore": "/tmp/peerLedger/ledgersData/pvtdataStore"
  }
]
```

*Limitation:* The ledger may be divided to multiple files when it becomes huge, but the plugin currently
only supports a single file. You may try to check the divided files by concatenating the ledger files.
Even if the directory is specified with the JSON, the plugin uses only the first file(`blockfile_000000`).

### fabric-query2

This plugin checks blocks by obtaining them calling `qscc` system chaincode in a peer.
As this plugin uses v2.x of Fabric SDK, this only supports v2.x peers. For v1.4 peers, the `fabric-query` plugin should be used.

The configuration value for the plugin should be the file name to a configuration JSON.
Note that the structure of the JSON is far different from that for `fabric-query`.

The format is shown below:

| Key name                       | Type    | Description                                                         |
|--------------------------------|---------|---------------------------------------------------------------------|
| `peer.url`                     | string  | URL to a peer (e.g. `grpcs://peer1.org1.example.com:7051`)          |
| `peer.mspID`                   | string  | MSP ID for the organization which the peer belongs to               |
| `peer.tlsCACertFile`           | string  | CA certificate for TLS with the peer (Required when TLS is enabled) |
| `channel`                      | string  | Channel name                                                        |
| `client.certFile`              | string  | Certificate for the client identity to use to connect to the peer   |
| `client.keyFile`               | string  | Private key for the client identity to use to connect to the peer   |
| `client.mspID`                 | string  | MSP ID for the client identity                                      |
| `client.mutualTLS.certFile`    | string  | Client certificate (Required when mutual TLS is enabled)            |
| `client.mutualTLS.keyFile`     | string  | Client private key (Required when mutual TLS is enabled)            |

Example:
```json
{
  "peer": {
    "url": "grpcs://localhost:7051",
    "mspID": "Org1MSP",
    "tlsCACertFile": "/opt/gopath/src/github.com/hyperledger/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/tlscacerts/tls-localhost-7054-ca-org1.pem"
  },
  "channel": "mychannel",
  "client": {
    "certFile": "/opt/gopath/src/github.com/hyperledger/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/cert.pem",
    "keyFile": "/opt/gopath/src/github.com/hyperledger/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/keystore/e488b2baef3f8121f9122140bd937c7708336f185e1668d66bbfbf5157379e27_sk",
    "mspID": "Org1MSP"
  }
}
```

## Result JSON

The result JSON contains information for each block and transaction, along with
checks performed for the block and transaction.

Below is some excerpt from a result JSON:

```
{
  "blocks": [
    {
      "number": 3,
      "results": [
        {
          "result": "OK",
          "predicate": "EQ",
          "operands": [
            "Block(3).PreviousHash",
            "HashForPrev(Block(2))"
          ]
        },
        {
          "result": "OK",
          "predicate": "EQ",
          "operands": [
            "Block(3).Hash",
            "HashForSelf(Block(3))"
          ]
        },
        ...
      ]
    }
  ],
  "transactions": [
    ...
    {
      "id": "b9f33606fb6b415782a773c50ef1deb67a2e4805536e3ef27f67b9c2086a3d80",
      "blockNumber": 3,
      "results": [
        {
          "result": "OK",
          "predicate": "INVOKE",
          "operands": [
            "VerifySignatureHeader",
            "Block(3).Tx(3:0).SignatureHeader",
            "Block(2).ConfigTx.Config.ApplicationMSP"
          ]
        },
        ...
    }
    ...
  }
}
```

The part above shows that the block 3's previous hash entry is checked against the actual hash value for the block 2,
and the block 3's hash entry is also checked against the actual hash value for block 3.
It also shows that the signature header (certificate) for the transaction `b9f336..` is checked against the CA certificate for the configuration.

The results for these checks are all "OK," which means that the integrity of the blockchain is verified.

### Comparison of multiple ledgers

When multiple ledgers are specified, Blockchain Verifier checks the hash value of each block in a ledger with the hash values of the block
in the other ledgers.
Currently, both the "fabric-block" and "fabric-query2" plugins support this feature.
The first ledger in the configuration is considered to be "preferred," and the other ledgers are used only in this check.

## Platform Checkers

Blockchain Verifier has several checkers to perform platform-level checks, independent of applications, as described in the table below.

| Checker name         | Target platform    | Checks to be performed                                                 |
|----------------------|--------------------|------------------------------------------------------------------------|
| `generic-block`      | (Generic)          | The hash values of the blocks                                          |
| `fabric-block`       | Hyperledger Fabric | The signature in the metadata of the blocks                            |
| `fabric-transaction` | Hyperledger Fabric | The signature in the transactions, the hash values of the private data |
| `multiple-ledgers`   | (Generic)          | The hash values of the blocks from different nodes                     |

## Application Specific Check

You can write application specific check programs that are called from Blockchain Verifier.
The check program should export a class that implements `AppStateCheckLogic` and/or `AppTransactionCheckLogic`
(as defined in `check/index.ts`)

For detail, please refer to [the application checker reference](docs/application-checker.md).

## Checkpoints

v0.4.0 introduces a checkpoint feature for Blockchain Verifier. A checkpoint is a file which contains what are required 
for Blockchain Verifier to resume checks from the last block in the future, such as block hashes, state database etc.

A checkpoint is saved when the `-s` option is specified. When a checkpoint is specified with the `-r` option, Blockchain
Verifier resumes checks from the next block of the last block saved in the checkpoint.
A user may save a checkpoint after executing Blockchain Verifier for the ledger with 100 blocks; they can continue checks
using the checkpoint from the 101st block, skipping the first 100 blocks as they are considered "verified" with the checkpoint.

### Caveat (for key-value ledgers)

Starting v0.3.1, Blockchain Verifier does not process the key-value pairs in transaction unless any application checker is
specified. When it is directed to save a checkpoint, it DOES process key-value pairs and save the state information into the
checkpoint because the information might be needed in future execution. If you really want to suppress the key-value processing,
use the `--skip-key-value` (`-i`) option along with the `-s` option.

Please also notice that application checkers will not be able to obtain history for key-value pairs before the checkpoint.

## TODO

- Documents (API reference, Data specification)
- Unit tests
- Support for more plugins and platforms

## Changes

### v0.5.0 (To be released)

- Delete *fabric-query* plugin and eliminate support for Hyperledger Fabric v1.4
- Drop support for Hyperledger Fabric v2.3
- Add support for Hyperledger Fabric v2.5 (LTS)

### v0.4.0 (Sep. 9, 2022)

- Add the checkpoint feature

### v0.3.1 (Aug. 31, 2021)

- Add an option to skip certain checkers
- Add integration tests (with Hyperledger Fabric v2.2/2.3)

### v0.3.0 (Feb. 25, 2021)

- Fix an error when verifying Hyperledger Fabric v2.3 blocks
- Add a check that compares the hash values of each block in multiple ledgers

### v0.2.2 (Oct. 8, 2020)

- Add "fabric-query2" plugin to support querying blocks from v2.x peers

### v0.2.1 (Oct. 1, 2020)

- Most of the Fabric-related plugins are switched to use fabric-sdk-node v2.2

### v0.2.0 (Feb. 13, 2020)

- Support application specific check plugins

### v0.1.3 (Aug. 6, 2019)

- Fix check logic for signatures in the metadata

## License

Apache-2.0 (See [LICENSE](LICENSE))
