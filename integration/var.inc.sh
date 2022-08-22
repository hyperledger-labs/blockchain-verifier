# Copyright 2021 Hitachi, Ltd.
#
# SPDX-License-Identifier: Apache-2.0

CURDIR=`dirname "$0" | xargs readlink -f`
SAMPLES="${CURDIR}/fabric-samples"

export PATH="$PATH:${SAMPLES}/bin"
