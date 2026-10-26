import { Effect, Schema } from "effect";
import type { Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { blobs, nullable, pairs, tuple } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { Finite, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { moduleDouble } from "#/commands/modules/Reply";
import { queryTokens } from "#/commands/vectors/Input";
import type { VectorQuery } from "#/commands/vectors/Input";
import type { RedisArgument } from "#/RedisArgument";

export interface VectorSimilarityOptions {
  readonly count?: Integer;
  readonly epsilon?: number;
  readonly ef?: Integer;
  readonly filter?: string;
  readonly filterEf?: Integer;
  readonly truth?: boolean;
  readonly noThread?: boolean;
}
const Options = Schema.Struct({
  count: Schema.optionalKey(Positive),
  epsilon: Schema.optionalKey(Finite.check(Schema.isGreaterThan(0))),
  ef: Schema.optionalKey(Positive.check(Schema.makeFilter((n) => n <= 1_000_000))),
  filter: Schema.optionalKey(Schema.String),
  filterEf: Schema.optionalKey(Positive),
  truth: Schema.optionalKey(Schema.Boolean),
  noThread: Schema.optionalKey(Schema.Boolean),
});

const args = (query: VectorQuery, options: VectorSimilarityOptions, flags: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const selected = yield* parse(Options, options);
    const vector = yield* queryTokens(query);

    return [
      ...vector,
      ...flags,
      ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
      ...(selected.epsilon === undefined ? [] : ["EPSILON", String(selected.epsilon)]),
      ...(selected.ef === undefined ? [] : ["EF", String(selected.ef)]),
      ...(selected.filter === undefined ? [] : ["FILTER", selected.filter]),
      ...(selected.filterEf === undefined ? [] : ["FILTER-EF", String(selected.filterEf)]),
      ...(selected.truth ? ["TRUTH"] : []),
      ...(selected.noThread ? ["NOTHREAD"] : []),
    ];
  });

export interface VectorMatch {
  readonly element: Uint8Array;
  readonly score: number;
  readonly attributes: Option.Option<Uint8Array>;
}

const matches: ReplyDecoder<ReadonlyArray<VectorMatch>> = (reply) => {
  const value = undecorate(reply);
  if (value._tag === "Map")
    return pairs(
      blob,
      tuple(moduleDouble, nullable(blob)),
    )(reply).pipe(
      Effect.map((entries) =>
        entries.map(([element, [score, attributes]]) => ({ element, score, attributes })),
      ),
    );
  if (value._tag !== "Array" || value.values.length % 3 !== 0)
    return Effect.fail(mismatch("array", reply));

  const entries = [];
  for (let i = 0; i < value.values.length; i += 3) {
    const [element, score, attributes] = value.values.slice(i, i + 3);
    if (element === undefined || score === undefined || attributes === undefined)
      return Effect.fail(mismatch("array", reply));
    entries.push([element, score, attributes] as const);
  }

  return Effect.forEach(entries, ([element, score, attributes]) =>
    Effect.gen(function* () {
      return {
        element: yield* blob(element),
        score: yield* moduleDouble(score),
        attributes: yield* nullable(blob)(attributes),
      };
    }),
  );
};

export const vsim = (
  key: RedisArgument,
  query: VectorQuery,
  options: VectorSimilarityOptions = {},
) => moduleKeyed("vectorset", "VSIM", key, blobs, args(query, options, []));

export const vsimWithScores = (
  key: RedisArgument,
  query: VectorQuery,
  options: VectorSimilarityOptions = {},
) =>
  moduleKeyed(
    "vectorset",
    "VSIM",
    key,
    pairs(blob, moduleDouble),
    args(query, options, ["WITHSCORES"]),
  );

export const vsimWithAttributes = (
  key: RedisArgument,
  query: VectorQuery,
  options: VectorSimilarityOptions = {},
) =>
  moduleKeyed(
    "vectorset",
    "VSIM",
    key,
    pairs(blob, nullable(blob)),
    args(query, options, ["WITHATTRIBS"]),
  );

export const vsimWithScoresAndAttributes = (
  key: RedisArgument,
  query: VectorQuery,
  options: VectorSimilarityOptions = {},
) =>
  moduleKeyed(
    "vectorset",
    "VSIM",
    key,
    matches,
    args(query, options, ["WITHSCORES", "WITHATTRIBS"]),
  );
