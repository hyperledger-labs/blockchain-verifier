#!/bin/sh

. "`dirname $0`/var.inc.sh"

DEST=${CURDIR}/artifacts
PEERS="peer0.org1.example.com peer0.org2.example.com"

for P in ${PEERS}; do
    mkdir -p ${DEST}/${P}

    docker cp ${P}:/var/hyperledger/production - | tar -C ${DEST}/${P} -x --strip-components 1
done
