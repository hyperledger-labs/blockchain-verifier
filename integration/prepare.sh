#!/bin/sh
#
# Copyright 2021 Hitachi, Ltd.
#
# SPDX-License-Identifier: Apache-2.0

set -e

. "`dirname $0`/var.inc.sh"

if [ $# -lt 2 ]; then
    echo "Usage:" $0 "(Fabric version)" "(Fabric CA version)" 1>&2
    exit 1
fi

cd ${CURDIR}
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- -f $1 -c $2

cd ${SAMPLES}/test-network

./network.sh down || true
./network.sh up -ca -s couchdb
./network.sh createChannel -c mychannel
