# BCVerifier (Blockchain Verifier)

## Overview

The goal of this tool is to verify the integrity of blockchain blocks and transactions.

## Supported Blockchain Platforms

- Hyperledger Fabric v1.4
- Hyperledger Fabric v2.2

## Prerequisites

- Node.js >= v10.15

## Install

As the tool is written in TypeScript, you need to compile it before execution.

```
$ git clone https://github.com/shimos/bcverifier
$ npm install
$ npm run build
```

## Usage

```
$ node ./build/cli.js -n (Network plugin) -c (Network config) -o (Result file) (Command)
```

Run with `-h` for the full list of the options.

### Options

| Option          | Description                                                                                        |
|-----------------|----------------------------------------------------------------------------------------------------|
| `-n (plugin)`   | Specify the name of the network plugin to use                                                      |
| `-c (config)`   | Configuration passed to the network plugin. See the description for the network plugins for detail |
| `-o (file)`     | Save the result JSON in the specified file                                                         |
| `-k (checkers)` | Specify the modules to use as application-specific checkers                                        |

### Commands

| Command       | Description                                                 |
|---------------|-------------------------------------------------------------|
| `start`       | Start verification and save the result if `-o` is specified |

### Example

```
$ node ./build/cli.js -n fabric-block -c /tmp/block/blockfile_000000 -o result.json start
```

Runs verification against a Hyperledger Fabric ledger file `/tmp/block/blockfile_000000` using the `fabric-block` plugin.

## Network plugins

| Name            | Supported Platform          | Description                                | Config value (`-c` option)             |
|-----------------|-----------------------------|--------------------------------------------|----------------------------------------|
| `fabric-block`  | Hyperledger Fabric v1.4/2.2 | Verify a ledger file and private DB        | Path to the ledger file or config JSON |
| `fabric-query`  | Hyperledger Fabric v1.4     | Verify blocks by querying to a peer        | Path to the query config file          |
| `fabric-query2` | Hyperledger Fabric v2.2     | Verify blocks by querying to a peer (v2.x) | Path to the query config file (v2)     |

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
```
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
```
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

### fabric-query

This plugin checks blocks by obtaining them using `query` method to a peer.

The configuration value for the plugin should be the file name to the configuration JSON.
The format for the JSON is as follows:

| Key name                       | Type    | Description                                                   |
|--------------------------------|---------|---------------------------------------------------------------|
| `connectionProfile`            | string  | path to the connection profile                                |
| `useDiscovery`                 | boolean | whether to use the service discovery                          |
| `client.mspID`                 | string  | MSP ID for the Hyperledger Fabric client                      |
| `client.peerName`              | string  | peer name to query                                            |
| `client.channelName`           | string  | channel name                                                  |
| `client.credentials.useAdmin`  | boolean | whether to use the admin credentials described in the profile |
| `client.credentials.mutualTLS` | boolean | whether to use mutual TLS                                     |
| `client.credentials.userName`  | string  | user name (not so meaningful)                                 |
| `client.credentials.certFile`  | string  | path to signed certificate to use for the client              |
| `client.credentials.keyFile`   | string  | path to private key to use for the client                     |

Example:

```
{
  "connectionProfile": "profile.yaml",
  "useDiscovery": true,
  "client": {
    "mspID": "Org1MSP",
    "peerName": "peer0.org1.example.com",
    "channelName": "mychannel",
    "credentials": {
      "useAdmin": false,
      "mutualTLS": false,
      "userName": "user",
      "certFile": "credentials/User1@org1.example.com-cert.pem",
      "keyFile": "credentials/e4af7f90fa89b3e63116da5d278855cfb11e048397261844db89244549918731_sk"
    }
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

## Application Specific Check

You can write application specific check programs that are called from BCVerifier.
The check program should export a class that implements `AppStateCheckLogic` and/or `AppTransactionCheckLogic`
(as defined in `check/index.ts`)

For detail, please refer to [the application checker reference](docs/application-checker.md).

## TODO

- Documents (API reference, Data specification)
- Unit tests and integration tests
- Support for more plugins and platforms
  - Multiple ledger files for Hyperledger Fabric

## Changes

### v0.2.1 (Oct. 1, 2020)

- Most of the Fabric-related plugins are switched to use fabric-sdk-node v2.2

### v0.2.0 (Feb. 13, 2020)

- Support application specific check plugins

### v0.1.3 (Aug. 6, 2019)

- Fix check logic for signatures in the metadata

## License

Apache-2.0 (See [LICENSE](LICENSE))
