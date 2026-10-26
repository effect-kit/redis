import type { Effect, Option, Redacted } from "effect";

import { Commands } from "#/index";
import type { RedisAdminClient, RedisSession, ServerInfo } from "#/index";

declare const admin: RedisAdminClient;
declare const session: RedisSession;
const info = admin.info(["all"]);
const config = admin.configGet(["*"]);
const memory = admin.memoryUsage("key");
const migration = admin.migrate([new Uint8Array([255])], {
  host: "destination",
  port: 6379,
  database: 0,
  timeoutMillis: 1000,
});
const selected = session.selectDatabase(1);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type AdministrationContracts = [
  Assert<Equal<Effect.Success<typeof info>, ServerInfo>>,
  Assert<
    Effect.Success<typeof config> extends Redacted.Redacted<
      ReadonlyArray<readonly [Uint8Array, Uint8Array]>
    >
      ? true
      : false
  >,
  Assert<Equal<Effect.Success<typeof memory>, Option.Option<bigint>>>,
  Assert<Equal<Effect.Success<typeof migration>, "OK" | "NOKEY">>,
  Assert<Equal<Effect.Services<typeof selected>, never>>,
];

// @ts-expect-error Secret-bearing settings require an explicit redacted value.
Commands.configSet([["requirepass", "secret"]]);
// @ts-expect-error Authentication cannot expose a plain password in the public contract.
session.authenticate({ password: "secret" });
// @ts-expect-error Filters use a reviewed selector.
Commands.commandList({ by: "GLOB", value: "*" });
// @ts-expect-error MIGRATE needs at least one key and explicit destination settings.
admin.migrate([], {});
// @ts-expect-error Arbitrary connection controls cannot be smuggled through known typed options.
Commands.clientSetInfo("REPLY", "OFF");
