import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { simpleText } from "#/command/reply/Data";
import { blob, integer, optional, status } from "#/command/reply/Scalars";
import { keyed, ordinary } from "#/commands/internal/Command";
import { NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/keys/Catalog";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export const objectEncoding = (key: RedisArgument) =>
  keyed(catalog["OBJECT ENCODING"], key, Effect.succeed([]), optional(blob));

export const objectFreq = (key: RedisArgument) =>
  keyed(catalog["OBJECT FREQ"], key, Effect.succeed([]), optional(integer));

export const objectIdletime = (key: RedisArgument) =>
  keyed(catalog["OBJECT IDLETIME"], key, Effect.succeed([]), optional(integer));

export const objectRefcount = (key: RedisArgument) =>
  keyed(catalog["OBJECT REFCOUNT"], key, Effect.succeed([]), optional(integer));

export const objectHelp = () =>
  ordinary(
    catalog["OBJECT HELP"],
    array(simpleText),
    Effect.succeed({ tokens: ["OBJECT", "HELP"], routing: { _tag: "Keyless" } }),
  );

const RestoreOptions = Schema.Struct({
  replace: Schema.optionalKey(Schema.Boolean),
  absolute: Schema.optionalKey(Schema.Boolean),
  idleTime: Schema.optionalKey(NonNegative),
  frequency: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
});
export type RestoreOptions = typeof RestoreOptions.Type;

export const restore = (
  key: RedisArgument,
  milliseconds: Integer,
  serialized: RedisArgument,
  options: RestoreOptions = {},
) =>
  keyed(
    catalog.RESTORE,
    key,
    Effect.gen(function* () {
      const ttl = yield* parse(NonNegative, milliseconds);
      const o = yield* parse(RestoreOptions, options);
      if (o.idleTime !== undefined && o.frequency !== undefined)
        return yield* new CommandInputError({ delivery: "unsent", reason: "options" });

      return [
        String(ttl),
        serialized,
        ...(o.replace ? ["REPLACE"] : []),
        ...(o.absolute ? ["ABSTTL"] : []),
        ...(o.idleTime === undefined ? [] : ["IDLETIME", String(o.idleTime)]),
        ...(o.frequency === undefined ? [] : ["FREQ", String(o.frequency)]),
      ];
    }),
    status("OK"),
    "write",
  );
