import type { Effect } from "effect";

import { Commands } from "#/index";
import type { RedisAdminClient, RedisClient, RedisSession } from "#/index";

declare const admin: RedisAdminClient;
declare const session: RedisSession;
declare const redis: RedisClient;
const prepared = Commands.himportSet("key", "fieldset", [new Uint8Array([255])]);
const discarded = session.himportDiscardAll();
const status = admin.backupStatus();
const leased = admin.withSession((client) => client.himportPrepare("fieldset", ["field"]));

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type ImportBackupContracts = [
  Assert<Equal<Effect.Services<typeof prepared.prepare>, never>>,
  Assert<Equal<Effect.Success<typeof discarded>, bigint>>,
  Assert<Equal<Effect.Success<typeof status>["state"], string>>,
  Assert<Equal<Effect.Success<typeof status>["startTimeSeconds"], bigint>>,
  Assert<Equal<Effect.Success<typeof leased>, void>>,
];

// @ts-expect-error A fieldset requires at least one explicitly ordered field.
Commands.himportPrepare("fieldset", []);
// @ts-expect-error Shared Redis cannot retain physical-client fieldsets.
redis.himportSet("key", "fieldset", ["value"]);
