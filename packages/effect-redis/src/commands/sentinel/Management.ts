import { Effect, Redacted, Schema } from "effect";

import { pairs, simpleText, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { sensitive } from "#/commands/admin/Build";
import { Pairs, parse } from "#/commands/internal/Input";
import { Name, Port, name, sentinelCommand } from "#/commands/sentinel/Build";
import type { RedisArgument } from "#/RedisArgument";

type Settings = Redacted.Redacted<
  readonly [
    readonly [RedisArgument, RedisArgument],
    ...Array<readonly [RedisArgument, RedisArgument]>,
  ]
>;
const settings = (entries: Settings) =>
  parse(Schema.Redacted(Pairs), entries).pipe(
    Effect.map((selected) => Redacted.value(selected).flatMap(([key, value]) => [key, value])),
  );

export const sentinelMonitor = (service: string, host: string, port: number, quorum: number) =>
  sentinelCommand(
    "MONITOR",
    status("OK"),
    parse(Schema.Tuple([Name, Name, Port, Schema.Int.check(Schema.isGreaterThan(0))]), [
      service,
      host,
      port,
      quorum,
    ]).pipe(Effect.map(([s, h, p, q]) => [s, h, String(p), String(q)])),
  );

export const sentinelRemove = (service: string) =>
  sentinelCommand("REMOVE", status("OK"), name(service));
export const sentinelReset = (pattern: string) => sentinelCommand("RESET", unsigned, name(pattern));
export const sentinelFlushConfig = () => sentinelCommand("FLUSHCONFIG", status("OK"));
export const sentinelFailover = (
  service: string,
  options: { readonly coordinated?: boolean } = {},
) =>
  sentinelCommand(
    "FAILOVER",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ coordinated: Schema.optionalKey(Schema.Boolean) }),
        options,
      );
      return [...(yield* name(service)), ...(selected.coordinated ? ["COORDINATED"] : [])];
    }),
  );

/** Sentinel options include auth-pass; settings and configuration reports stay redacted. */
export const sentinelSet = (service: string, entries: Settings) =>
  sentinelCommand(
    "SET",
    status("OK"),
    Effect.gen(function* () {
      const prefix = yield* name(service);
      const tail = yield* settings(entries);

      return [...prefix, ...tail];
    }),
  );
export const sentinelConfigGet = (patterns: readonly [string, ...string[]]) =>
  sentinelCommand(
    "CONFIG GET",
    sensitive(pairs(simpleText, simpleText)),
    parse(Schema.NonEmptyArray(Name), patterns),
  );
export const sentinelConfigSet = (entries: Settings) =>
  sentinelCommand("CONFIG SET", status("OK"), settings(entries));
export const sentinelDebug = () => sentinelCommand("DEBUG", pairs(simpleText, simpleText));
export const sentinelDebugSet = (entries: Settings) =>
  sentinelCommand("DEBUG", status("OK"), settings(entries));
