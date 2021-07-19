#!/bin/bash
#
# Copyright 2021 Hitachi, Ltd.
#
# SPDX-License-Identifier: Apache-2.0

set -e

. "`dirname $0`/var.inc.sh"

if [ $# -lt 1 ]; then
    echo "Usage:" $0 "[-o]" "(org)" "[(arguments)...]" 1>&2
    exit 1
fi

if [ "$1" = "-o" ]; then
    shift 1
    WITH_ORDERER=t
fi

cd ${SAMPLES}/test-network
. ./scripts/envVar.sh

parsePeerConnectionParameters $1

if [ "${WITH_ORDERER}" = "t" ]; then
    VARNAME=PEER0_ORG$1_CA

    ADDITIONAL_PARAMS="--tlsRootCertFile ${!VARNAME}"
fi

shift 1

FABRIC_CFG_PATH=${SAMPLES}/config peer "$@" ${ADDITIONAL_PARAMS}
