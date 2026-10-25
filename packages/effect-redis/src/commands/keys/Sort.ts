import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { blob, integer, optional } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, Arguments, Integer, NonNegative, parse } from "#/commands/internal/Input";
import { catalog } from "#/commands/keys/Catalog";
import type { RedisArgument } from "#/RedisArgument";

const Options = Schema.Struct({
  by: Schema.optionalKey(Argument),
  get: Schema.optionalKey(Arguments),
  order: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])),
  alpha: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(Schema.Struct({ offset: NonNegative, count: Integer })),
});
export type SortOptions = typeof Options.Type;

const intent = (
  name: "SORT" | "SORT_RO",
  key: RedisArgument,
  options: SortOptions,
  destination?: RedisArgument,
) =>
  Effect.gen(function* () {
    const o = yield* parse(Options, options);
    const tokens: [RedisArgument, ...RedisArgument[]] = [name, key];
    const patterns: RedisArgument[] = [];
    if (o.by !== undefined) {
      tokens.push("BY", o.by);
      if (o.by !== "nosort") patterns.push(o.by);
    }
    if (o.limit !== undefined) tokens.push("LIMIT", String(o.limit.offset), String(o.limit.count));
    for (const get of o.get ?? []) {
      tokens.push("GET", get);
      if (get !== "#") patterns.push(get);
    }
    if (o.order !== undefined) tokens.push(o.order);
    if (o.alpha) tokens.push("ALPHA");

    const keys: [
      { index: number; access: "read" | "write" },
      ...Array<{ index: number; access: "read" | "write" }>,
    ] = [{ index: 1, access: "read" }];
    if (destination !== undefined) {
      tokens.push("STORE", destination);
      keys.push({ index: tokens.length - 1, access: "write" });
    }

    // Pattern-derived keys are unresolved until values are read; a Cluster router must not guess.
    const [first, ...rest] = patterns;
    return {
      tokens,
      routing:
        first === undefined
          ? { _tag: "Keys" as const, keys }
          : {
              _tag: "Dynamic" as const,
              keys,
              patterns: [first, ...rest] as readonly [RedisArgument, ...RedisArgument[]],
            },
    };
  });

export const sort = (key: RedisArgument, options: SortOptions = {}) =>
  ordinary(catalog.SORT, array(optional(blob)), intent("SORT", key, options));

export const sortRo = (key: RedisArgument, options: SortOptions = {}) =>
  ordinary(catalog.SORT_RO, array(optional(blob)), intent("SORT_RO", key, options));

export const sortStore = (
  key: RedisArgument,
  destination: RedisArgument,
  options: SortOptions = {},
) => ordinary(catalog.SORT, integer, intent("SORT", key, options, destination));
