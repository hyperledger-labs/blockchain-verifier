#!/bin/sh
#
# Copyright 2021 Hitachi, Ltd.
#
# SPDX-License-Identifier: Apache-2.0

. "`dirname $0`/var.inc.sh"

set -e

# Initialize CC
cd ${SAMPLES}/test-network
./network.sh deployCC -ccn basic -ccl go -ccp ../asset-transfer-basic/chaincode-go

# Run transactions
cd ${SAMPLES}/asset-transfer-basic/application-javascript
npm install
rm -rf wallet

node app.js
