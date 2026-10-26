import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, simpleText } from "#/command/reply/Data";
import { blob, integer, optional, status } from "#/command/reply/Scalars";
import { keyed, keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/keys/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export type Keys = readonly [RedisArgument, ...RedisArgument[]];

const multiple = (name: "DEL" | "EXISTS" | "TOUCH" | "UNLINK", keys: Keys) =>
  ordinary(
    catalog[name],
    integer,
    parse(Arguments, keys).pipe(
      Effect.map((values) => ({
        tokens: [name, ...values],
        routing: keyIndexes(
          values.map((_, index) => index + 1),
          name === "EXISTS" || name === "TOUCH" ? "read" : "read-write",
        ),
      })),
    ),
  );

export const del = (keys: Keys) => multiple("DEL", keys);

export const exists = (keys: Keys) => multiple("EXISTS", keys);

export const touch = (keys: Keys) => multiple("TOUCH", keys);

export const unlink = (keys: Keys) => multiple("UNLINK", keys);

export const type = (key: RedisArgument) =>
  keyed(catalog.TYPE, key, Effect.succeed([]), simpleText);

export const dump = (key: RedisArgument) =>
  keyed(catalog.DUMP, key, Effect.succeed([]), optional(blob));

/** This is a whole-database operation, not a cursor or a Cluster scatter/gather helper. */
export const keys = (pattern: RedisArgument) =>
  ordinary(
    catalog.KEYS,
    array(blob),
    Effect.succeed({ tokens: ["KEYS", pattern], routing: { _tag: "Keyless" } }),
  );

export const randomkey = () =>
  ordinary(
    catalog.RANDOMKEY,
    optional(blob),
    Effect.succeed({ tokens: ["RANDOMKEY"], routing: { _tag: "Keyless" } }),
  );

export const rename = (source: RedisArgument, destination: RedisArgument) =>
  ordinary(
    catalog.RENAME,
    status("OK"),
    Effect.succeed({
      tokens: ["RENAME", source, destination],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );

export const renamenx = (source: RedisArgument, destination: RedisArgument) =>
  ordinary(
    catalog.RENAMENX,
    boolean,
    Effect.succeed({
      tokens: ["RENAMENX", source, destination],
      routing: keyIndexes([1, 2], "read-write"),
    }),
  );

const CopyOptions = Schema.Struct({
  database: Schema.optionalKey(NonNegative),
  replace: Schema.optionalKey(Schema.Boolean),
});
export type CopyOptions = typeof CopyOptions.Type;

export const copy = (
  source: RedisArgument,
  destination: RedisArgument,
  options: CopyOptions = {},
) =>
  ordinary(
    catalog.COPY,
    boolean,
    parse(CopyOptions, options).pipe(
      Effect.map((o) => ({
        tokens: [
          "COPY",
          source,
          destination,
          ...(o.database === undefined ? [] : ["DB", String(o.database)]),
          ...(o.replace ? ["REPLACE"] : []),
        ],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "read" },
            { index: 2, access: "write" },
          ],
        },
      })),
    ),
  );

export const move = (key: RedisArgument, database: Integer) =>
  keyed(
    catalog.MOVE,
    key,
    parse(NonNegative, database).pipe(Effect.map((db) => [String(db)])),
    boolean,
    "read-write",
  );
