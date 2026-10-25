import { Effect, Schema } from "effect";

import { members } from "#/command/reply/Data";
import { blob, integer } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, NonNegative, parse } from "#/commands/internal/Input";
import { catalog } from "#/commands/sets/Catalog";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type SetKeys = readonly [RedisArgument, ...RedisArgument[]];

const algebra = (name: "SDIFF" | "SINTER" | "SUNION", keys: SetKeys) =>
  ordinary(
    catalog[name],
    members(blob),
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: [name, ...values],
        routing: keyIndexes(
          values.map((_, index) => index + 1),
          "read",
        ),
      })),
    ),
  );

export const sdiff = (keys: SetKeys) => algebra("SDIFF", keys);

export const sinter = (keys: SetKeys) => algebra("SINTER", keys);

export const sunion = (keys: SetKeys) => algebra("SUNION", keys);

const store = (
  name: "SDIFFSTORE" | "SINTERSTORE" | "SUNIONSTORE",
  destination: RedisArgument,
  keys: SetKeys,
) =>
  ordinary(
    catalog[name],
    integer,
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: [name, destination, ...values],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            ...values.map((_, index) => ({ index: index + 2, access: "read" as const })),
          ],
        },
      })),
    ),
  );

export const sdiffstore = (destination: RedisArgument, keys: SetKeys) =>
  store("SDIFFSTORE", destination, keys);

export const sinterstore = (destination: RedisArgument, keys: SetKeys) =>
  store("SINTERSTORE", destination, keys);

export const sunionstore = (destination: RedisArgument, keys: SetKeys) =>
  store("SUNIONSTORE", destination, keys);

const CardinalityOptions = Schema.Struct({
  limit: Schema.optionalKey(NonNegative),
  approximate: Schema.optionalKey(Schema.Boolean),
});
export type SetCardinalityOptions = typeof CardinalityOptions.Type;

const cardinality = (
  name: "SDIFFCARD" | "SINTERCARD" | "SUNIONCARD",
  keys: SetKeys,
  options: SetCardinalityOptions,
) =>
  ordinary(
    catalog[name],
    integer,
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);
      const parsed = yield* parse(CardinalityOptions, options);
      const flags: RedisArgument[] = [];
      // APPROX is a union-only extension; do not silently discard it for other operations.
      if (parsed.approximate) {
        if (name !== "SUNIONCARD")
          return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
        flags.push("APPROX");
      }
      if (parsed.limit !== undefined) flags.push("LIMIT", String(parsed.limit));
      return {
        tokens: [name, String(values.length), ...values, ...flags],
        routing: keyIndexes(
          values.map((_, index) => index + 2),
          "read",
        ),
      };
    }),
  );

export const sdiffcard = (
  keys: SetKeys,
  options: Omit<SetCardinalityOptions, "approximate"> = {},
) => cardinality("SDIFFCARD", keys, options);

export const sintercard = (
  keys: SetKeys,
  options: Omit<SetCardinalityOptions, "approximate"> = {},
) => cardinality("SINTERCARD", keys, options);

export const sunioncard = (keys: SetKeys, options: SetCardinalityOptions = {}) =>
  cardinality("SUNIONCARD", keys, options);
