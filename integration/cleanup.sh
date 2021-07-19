#!/bin/sh
#
# Copyright 2021 Hitachi, Ltd.
#
# SPDX-License-Identifier: Apache-2.0

. "`dirname $0`/var.inc.sh"

if [ -d ${CURDIR}/fabric-samples/test-network ]; then
    cd ${CURDIR}/fabric-samples/test-network
    ./network.sh down || true
fi

cd ${CURDIR}

rm -rf artifacts fabric-samples

docker ps -aq | xargs docker rm -f > /dev/null 2>&1
docker volume ls -q | xargs docker volume rm -f > /dev/null 2>&1

