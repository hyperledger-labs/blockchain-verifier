/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

declare module "fabric-client/lib/BlockDecoder" {
    export function decode(block: Buffer): any;
    export function decodeBlock(blockData: any): any;

    export class HeaderType {
        public static convertToString(type: number): string;
        public static decodePayloadBasedOnType(protoData: any, type: number): any;
    }
}
