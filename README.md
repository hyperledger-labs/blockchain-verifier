# BCVerifier (Blockchain Verifier)

## Overview

The goal of this tool is to verify the integrity of blockchain blocks and transactions.

## Supported Blockchain Platforms

- Hyperledger Fabric v1.1

## Prerequisite

- Node.js >= v8

## Install

As the tool is written in TypeScript, you need to compile it before execution.

```
$ git clone https://github.com/shimos/bcverifier
$ npm install
$ npm run build
```

## Usage

```
$ node ./dist/cli.js -n (Network plugin) -c (Network config) -o (Result file) (Command)
```

Run with `-h` for the full list of the options.

### Options

| Option        | Description                                                                                       |
|---------------|---------------------------------------------------------------------------------------------------|
| `-n (plugin)` | Specify the name of the network plugin to use                                                     |
| `-c (config)` | Configuration passed to the network plugin. See the description for the network plugin for detail |
| `-o (file)`   | Save the result JSON in the specified file                                                        |

### Commands

| Command       | Description                                                 |
|---------------|-------------------------------------------------------------|
| `start`       | Start verification and save the result if `-o` is specified |

### Example

```
$ node ./dist/cli.js -n fabric-block -c /tmp/block/blockfile_000000 -o result.json start
```

Runs verification against a Hyperledger Fabric ledger file `/tmp/block/blockfile_000000` using the `fabric-block` plugin.

## Network plugins

| Name           | Supported Platform      | Description           | Config value (`-c` option) |
|----------------|-------------------------|-----------------------|----------------------------|
| `fabric-block` | Hyperledger Fabric v1.1 | Verify a ledger file  | Path to the ledger file    |

### fabric-block

This plugin checks a ledger file for a channel in Hyperledger Fabric network.
The file can be usually found in `/var/lib/hyperledger/production/ledgersData/chains/chains/(channel name)` in a peer.

*Limitation:* The ledger may be divided to multiple files when it becomes huge, but the plugin currently
only supports a single file. You may try to check the divided files by concatenating the ledger files.

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
It also shows that the signature header (certificate) for the transaction `b8f336..` is checked against the CA certificate for the configuration.

The results for these checks are all "OK," which means that the integrity of the blockchain is verified.

## TODO

- Documents (API reference, Data specification)
- Unit tests and integration tests
- Support for more plugins and platforms
  - Multiple ledger files for Hyperledger Fabric
  - Querying the blocks from Hyperledger Fabric peers via network

## License

Apache-2.0 (See [LICENSE](LICENSE))
