import { Effect, Option, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { pairs, tuple } from "#/command/reply/Data";
import { blob, integer, mismatch, text, undecorate } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/strings/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export interface LcsMatch {
  readonly first: readonly [bigint, bigint];
  readonly second: readonly [bigint, bigint];
  readonly length: Option.Option<bigint>;
}

export interface LcsMatches {
  readonly length: bigint;
  readonly matches: ReadonlyArray<LcsMatch>;
}

const match: ReplyDecoder<LcsMatch> = (reply) =>
  Effect.gen(function* () {
    const value = undecorate(reply);
    if (value._tag !== "Array" || (value.values.length !== 2 && value.values.length !== 3))
      return yield* mismatch("array", reply);
    const [first, second, length] = value.values;
    if (first === undefined || second === undefined) return yield* mismatch("array", reply);

    return {
      first: yield* tuple(integer, integer)(first),
      second: yield* tuple(integer, integer)(second),
      length: length === undefined ? Option.none() : Option.some(yield* integer(length)),
    };
  });

const matches: ReplyDecoder<LcsMatches> = (reply) =>
  Effect.gen(function* () {
    const entries = yield* pairs(text, (value) => Effect.succeed(value))(reply);
    const length = entries.find(([key]) => key === "len")?.[1];
    const result = entries.find(([key]) => key === "matches")?.[1];
    if (length === undefined || result === undefined) return yield* mismatch("array", reply);

    return { length: yield* integer(length), matches: yield* array(match)(result) };
  });

export const lcs = (first: RedisArgument, second: RedisArgument) =>
  ordinary(
    catalog.LCS,
    blob,
    Effect.succeed({ tokens: ["LCS", first, second], routing: keyIndexes([1, 2], "read") }),
  );

export const lcsLength = (first: RedisArgument, second: RedisArgument) =>
  ordinary(
    catalog.LCS,
    integer,
    Effect.succeed({ tokens: ["LCS", first, second, "LEN"], routing: keyIndexes([1, 2], "read") }),
  );

export const lcsMatches = (
  first: RedisArgument,
  second: RedisArgument,
  options: { readonly minimumLength?: Integer; readonly withMatchLength?: boolean } = {},
) =>
  ordinary(
    catalog.LCS,
    matches,
    Effect.gen(function* () {
      const parsed = yield* parse(
        Schema.Struct({
          minimumLength: Schema.optionalKey(NonNegative),
          withMatchLength: Schema.optionalKey(Schema.Boolean),
        }),
        options,
      );
      const tail: RedisArgument[] = ["IDX"];

      if (parsed.minimumLength !== undefined)
        tail.push("MINMATCHLEN", String(parsed.minimumLength));
      if (parsed.withMatchLength) tail.push("WITHMATCHLEN");

      return { tokens: ["LCS", first, second, ...tail], routing: keyIndexes([1, 2], "read") };
    }),
  );
