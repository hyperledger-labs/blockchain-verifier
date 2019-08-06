/*
 * Copyright 2019 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { ResultSet } from "../result-set";

export interface OutputPlugin {
    convertResult(resultSet: ResultSet): Promise<Buffer>;
}
