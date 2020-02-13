# Application Checker

bcverifier supports check programs (modules) which users create for specific applications.
This supports two types of checks: chronological checks of keys (data) and of transactions.
In the former, a check function is called for each key (data), and in the latter, it is called for each transaction.

In the following, a sample check program is presented, which is written in TypeScript,
but you may select to write check programs with JavaScript.

## Program Structure

A check program (module) should export one class as its default export.

```typescript
import { AppTransactionCheckLogic, CheckPlugin, AppTransaction } from "bcverifier";

export default class FabCarChecker extends CheckPlugin implements AppTransactionCheckLogic {
    ...
}
```

The class should implement one or both of the following interfaces.

| Interface Name             | Description                                                                                   |
|----------------------------|-----------------------------------------------------------------------------------------------|
| `AppStateCheckLogic`       | A checker for data (the function will be called for each key that exists in the latest state) |
| `AppTransactionCheckLogic` | A checker for transactions (the function will be called for each transaction)                 |

## State Checker

The first type of checkers is for data. Checkers of this type should implement the `AppStateCheckLogic` interface:

```typescript
export interface AppStateCheckLogic {
    probeStateCheck(kvState: KeyValueState): Promise<boolean>;
    performStateCheck(kvState: KeyValueState): Promise<void>;
}
```

The `probeStateCheck` method is called to determine if the checker is willing to inspect the state.
The checker can check if the state is really for the expected applications.

The `performStateCheck` method is called to perform the checks.
The only argument is the latest state that consists of all the keys and values at the latest point.

## Transaction Checker

The second type is checkers for transactions. Checkers of this type should implement the `AppTransactionCheckLogic` interface:

```typescript
export interface AppTransactionCheckLogic {
    probeTransactionCheck(tx: AppTransaction): Promise<boolean>;
    performTransactionCheck(tx: AppTransaction): Promise<void>;
}
```

Like the interface for state checkers, the `probeTransactionCheck` method is called to determine if the checker is willing to inspect the transaction.
The `performTransactionCheck` method is called to perform the checks.
The methods are called for each transaction, first `probeTransactionCheck` then `performTransactionCheck`.

## Classes

This section briefly shows classes relevant to checkers.

### KeyValueState

An instance of the `KeyValueState` class represents a snapshot of the key-value data in the ledger.

```typescript
export interface KeyValueState {
    getKeys(): KeyValue[];
    getValue(key: Buffer): KeyValue;
}
```

The `getKeys` method returns the array of data (key-values), and the `getValue` method returns one key-value for the specified key.

### KeyValue

An instance of the `KeyValue` class represents a key-value pair, which is stored in the ledger.

```typescript
export interface KeyValue {
    getKey(): Buffer;
    getValue(): Buffer;
    getVersion(): Buffer;
    getHistory(): Promise<KeyValue[]>;
    getTransaction(): Promise<Transaction | null>;
}
```

The methods in the class are:

- `getKey`
  - Returns the key of the pair, and the `getValue` method returns the value, in `Buffer` (binary).
- `getVersion`
  - Returns the version of the value in binary.
- `getHistory`
  - Returns the array of the previous versions of the value in `KeyValue`.
- `getTransaction`
  - Returns the low-level `Transaction` object which created the version of the value.

### AppTransaction

An instance of the `AppTransaction` class represents a transaction with the read set and write set populated with the values.

```typescript
export interface AppTransaction {
    getInput(): KeyValuePair[];
    getOutput(): KeyValuePair[];
    getTransaction(): Transaction;
}
```

The `getInput` method returns the read set of the transaction, and the `getOutput` method returns the write set.
The read/write set is an array of `KeyValuePair` objects, which include the key, value, version
and a flag (`isDelete`) that indicates whether it is delete (*true*) or write (*false*).
The `getTransaction` method returns the low-level transaction object.

### How to execute

Run CLI with the `-k` option.

For example:

```sh
$ node ./build/cli.js -n fabric-block -c test/fabcar-1.4.1/blockfile_000000 -k ./samples/fabcar start
```

#### fabcar sample

Running the command above will perform checks implemented in [the sample fabcar checker](../src/samples/fabcar.ts)
on [the ledger for testing](../test/fabcar-1.4.1).

You will see the following messages from the checker:

```
INFO: Transaction 1f3ae6fa8b555241ddc7b327b011db6a0be72d1c35939ceb2aabfdaca7f18f20: createCar is ok
ERROR: CreateCar should not overwrite the existing car
INFO: Transaction f0d88ed25bf0456d921d733d514a3aa566a4d7792f8cd0f20f6296b6ca3c5757: changeCarOwner is ok
```

In the future, these messages will be integrated into the other checks performed by `bcverifier`.

### TODO/Limitation

- The result from the application checker is not aggregated to the other checks.
- Only the key-value data model is assumed and supported.
