/*
 * Copyright 2020 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

declare module "fabric-common/lib/BlockDecoder" {
    class BlockDecoder {
        public static decode(block: Buffer): any;

        public static decodeBlock(blockProto: any): any;
    }
    export = BlockDecoder;
}
