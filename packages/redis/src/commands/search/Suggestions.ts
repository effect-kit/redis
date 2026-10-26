import { Effect, Schema } from "effect";
import type { Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blobs, nullable, tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { Argument, Finite, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { moduleBoolean, moduleDouble } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const ftSugadd = (
  key: RedisArgument,
  term: RedisArgument,
  score: number,
  options: { readonly increment?: boolean; readonly payload?: RedisArgument } = {},
) =>
  moduleKeyed(
    "search",
    "FT.SUGADD",
    key,
    unsigned,
    Effect.gen(function* () {
      const value = yield* parse(Finite, score);
      const selected = yield* parse(
        Schema.Struct({
          increment: Schema.optionalKey(Schema.Boolean),
          payload: Schema.optionalKey(Argument),
        }),
        options,
      );
      return [
        term,
        String(value),
        ...(selected.increment ? ["INCR"] : []),
        ...(selected.payload === undefined ? [] : ["PAYLOAD", selected.payload]),
      ];
    }),
    "read-write",
  );
export const ftSugdel = (key: RedisArgument, term: RedisArgument) =>
  moduleKeyed("search", "FT.SUGDEL", key, moduleBoolean, Effect.succeed([term]), "read-write");
export const ftSuglen = (key: RedisArgument) => moduleKeyed("search", "FT.SUGLEN", key, unsigned);
export interface SearchSuggestionOptions {
  readonly fuzzy?: boolean;
  readonly max?: Integer;
}
export interface SearchSuggestion {
  readonly term: Uint8Array;
  readonly score: number;
  readonly payload: Option.Option<Uint8Array>;
}
const options = (
  prefix: RedisArgument,
  selection: SearchSuggestionOptions,
  flags: ReadonlyArray<string>,
) =>
  parse(
    Schema.Struct({ fuzzy: Schema.optionalKey(Schema.Boolean), max: Schema.optionalKey(Positive) }),
    selection,
  ).pipe(
    Effect.map((selected) => [
      prefix,
      ...(selected.fuzzy ? ["FUZZY"] : []),
      ...flags,
      ...(selected.max === undefined ? [] : ["MAX", String(selected.max)]),
    ]),
  );

const grouped =
  <A>(width: number, decode: ReplyDecoder<A>): ReplyDecoder<ReadonlyArray<A>> =>
  (reply) => {
    const value = undecorate(reply);
    if (value._tag !== "Array" || value.values.length % width !== 0)
      return Effect.fail(mismatch("array", reply));
    const groups = [];
    for (let index = 0; index < value.values.length; index += width)
      groups.push({ _tag: "Array" as const, values: value.values.slice(index, index + width) });
    return array(decode)({ _tag: "Array", values: groups });
  };
const suggestion: ReplyDecoder<SearchSuggestion> = (reply) => {
  const value = undecorate(reply);
  if (value._tag !== "Array" || value.values.length !== 3)
    return Effect.fail(mismatch("array", reply));
  const [term, score, payload] = value.values;
  if (term === undefined || score === undefined || payload === undefined)
    return Effect.fail(mismatch("array", reply));
  return Effect.gen(function* () {
    return {
      term: yield* blob(term),
      score: yield* moduleDouble(score),
      payload: yield* nullable(blob)(payload),
    };
  });
};
export const ftSugget = (
  key: RedisArgument,
  prefix: RedisArgument,
  selection: SearchSuggestionOptions = {},
) => moduleKeyed("search", "FT.SUGGET", key, blobs, options(prefix, selection, []));
export const ftSuggetWithScores = (
  key: RedisArgument,
  prefix: RedisArgument,
  selection: SearchSuggestionOptions = {},
) =>
  moduleKeyed(
    "search",
    "FT.SUGGET",
    key,
    grouped(2, tuple(blob, moduleDouble)),
    options(prefix, selection, ["WITHSCORES"]),
  );
export const ftSuggetWithPayloads = (
  key: RedisArgument,
  prefix: RedisArgument,
  selection: SearchSuggestionOptions = {},
) =>
  moduleKeyed(
    "search",
    "FT.SUGGET",
    key,
    grouped(2, tuple(blob, nullable(blob))),
    options(prefix, selection, ["WITHPAYLOADS"]),
  );
export const ftSuggetWithScoresAndPayloads = (
  key: RedisArgument,
  prefix: RedisArgument,
  selection: SearchSuggestionOptions = {},
) =>
  moduleKeyed(
    "search",
    "FT.SUGGET",
    key,
    grouped(3, suggestion),
    options(prefix, selection, ["WITHSCORES", "WITHPAYLOADS"]),
  );
