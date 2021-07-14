#!/bin/sh

. "`dirname $0`/var.inc.sh"

set -e

# Initialize CC
cd ${SAMPLES}/test-network
./network.sh deployCC -ccn fabcar -ccv 1 -cci initLedger -ccl go -ccp ../chaincode/fabcar/go

# Run transactions
cd ${SAMPLES}/fabcar/javascript
npm install
rm -rf wallet

node enrollAdmin.js
node registerUser.js
node invoke.js
