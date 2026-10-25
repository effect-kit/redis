import { Effect, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { boolean, withLength } from "#/command/reply/Data";
import { blob, optional, status } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Arguments, Pairs, parse } from "#/commands/internal/Input";
import { catalog } from "#/commands/strings/Catalog";
import { SetExpiry } from "#/commands/strings/SetOptions";
import type { RedisArgument } from "#/RedisArgument";

export type KeyValues = readonly [
  readonly [RedisArgument, RedisArgument],
  ...Array<readonly [RedisArgument, RedisArgument]>,
];

export const mget = (keys: readonly [RedisArgument, ...RedisArgument[]]) =>
  fromPreparation(
    Effect.gen(function* () {
      const values = yield* parse(Arguments, keys);

      return yield* ordinary(
        catalog.MGET,
        withLength(values.length, array(optional(blob))),
        Effect.succeed({
          tokens: ["MGET", ...values],
          routing: keyIndexes(
            values.map((_, index) => index + 1),
            "read",
          ),
        }),
      ).prepare;
    }),
  );

export const mset = (entries: KeyValues) =>
  ordinary(
    catalog.MSET,
    status("OK"),
    parse(Pairs, entries).pipe(
      Effect.map((pairs) => ({
        tokens: ["MSET", ...pairs.flat()],
        routing: keyIndexes(
          pairs.map((_, index) => 1 + index * 2),
          "write",
        ),
      })),
    ),
  );

export const msetnx = (entries: KeyValues) =>
  ordinary(
    catalog.MSETNX,
    boolean,
    parse(Pairs, entries).pipe(
      Effect.map((pairs) => ({
        tokens: ["MSETNX", ...pairs.flat()],
        routing: keyIndexes(
          pairs.map((_, index) => 1 + index * 2),
          "write",
        ),
      })),
    ),
  );

export interface MultiSetOptions {
  readonly condition?: "NX" | "XX";
  readonly expiry?: SetExpiry;
}

export const msetex = (entries: KeyValues, options: MultiSetOptions = {}) =>
  ordinary(
    catalog.MSETEX,
    boolean,
    Effect.gen(function* () {
      const pairs = yield* parse(Pairs, entries);
      const set = yield* parse(
        Schema.Struct({
          condition: Schema.optionalKey(Schema.Literals(["NX", "XX"])),
          expiry: Schema.optionalKey(SetExpiry),
        }),
        options,
      );
      const tail: RedisArgument[] = [];

      if (set.condition !== undefined && typeof set.condition === "string")
        tail.push(set.condition);
      if (set.expiry !== undefined) {
        tail.push(set.expiry.type);
        if (set.expiry.type !== "KEEPTTL") tail.push(String(set.expiry.value));
      }

      return {
        tokens: ["MSETEX", String(pairs.length), ...pairs.flat(), ...tail],
        routing: keyIndexes(
          pairs.map((_, index) => 2 + index * 2),
          "write",
        ),
      };
    }),
  );
