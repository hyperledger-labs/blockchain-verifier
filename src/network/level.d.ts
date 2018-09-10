/*
 * Copyright 2018 Hitachi America, Ltd.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* Temporary type definition for level */
declare module "level" {
    export default function level(db: string, options?: any, callback?: (error: any, db: any) => any): any;
}
