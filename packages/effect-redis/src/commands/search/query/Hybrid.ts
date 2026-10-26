import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { unsigned } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Argument, Finite, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { aggregateStepTokens } from "#/commands/search/query/Aggregate";
import type { SearchAggregateStep } from "#/commands/search/query/Aggregate";
import { Limit, Order } from "#/commands/search/query/Options";
import type { SearchProfile } from "#/commands/search/query/Profile";
import { profileResult } from "#/commands/search/query/Profile";
import type { SearchAggregateResult } from "#/commands/search/reply/Aggregate";
import { searchFields } from "#/commands/search/reply/Fields";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchHybridVector {
  readonly field: `@${string}`;
  readonly vector: RedisArgument;
  readonly neighbors?:
    | {
        readonly _tag: "KNN";
        readonly count: Integer;
        readonly efRuntime?: Integer;
        readonly shardKRatio?: number;
      }
    | { readonly _tag: "Range"; readonly radius: number; readonly epsilon?: number };
  readonly filter?: {
    readonly expression: RedisArgument;
    readonly policy?: "ADHOC" | "BATCHES";
    readonly batchSize?: Integer;
  };
  readonly yieldScoreAs?: RedisArgument;
}
export interface SearchHybridOptions {
  readonly scorer?: string;
  readonly textScoreAs?: RedisArgument;
  readonly combine?:
    | { readonly _tag: "RRF"; readonly constant?: number; readonly window?: Integer }
    | {
        readonly _tag: "Linear";
        readonly weights?: readonly [number, number];
        readonly window?: Integer;
      };
  readonly combinedScoreAs?: RedisArgument;
  readonly params?: ReadonlyArray<readonly [RedisArgument, RedisArgument]>;
  readonly timeoutMillis?: Integer;
  readonly limit?: { readonly offset: Integer; readonly count: Integer };
  readonly sortBy?: readonly [
    { readonly field: RedisArgument; readonly order?: "ASC" | "DESC" },
    ...Array<{ readonly field: RedisArgument; readonly order?: "ASC" | "DESC" }>,
  ];
  readonly noSort?: boolean;
  readonly explainScore?: boolean;
  readonly format?: "STRING" | "EXPAND";
  readonly steps?: ReadonlyArray<SearchAggregateStep>;
}
const Vector = Schema.Struct({
  field: Schema.String.check(Schema.isPattern(/^@.+$/)),
  vector: Argument,
  neighbors: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal("KNN"),
        count: Positive,
        efRuntime: Schema.optionalKey(Positive),
        shardKRatio: Schema.optionalKey(Finite.check(Schema.isGreaterThan(0))),
      }),
      Schema.Struct({
        _tag: Schema.Literal("Range"),
        radius: Finite.check(Schema.isGreaterThanOrEqualTo(0)),
        epsilon: Schema.optionalKey(Finite.check(Schema.isGreaterThanOrEqualTo(0))),
      }),
    ]),
  ),
  filter: Schema.optionalKey(
    Schema.Struct({
      expression: Argument,
      policy: Schema.optionalKey(Schema.Literals(["ADHOC", "BATCHES"])),
      batchSize: Schema.optionalKey(Positive),
    }),
  ),
  yieldScoreAs: Schema.optionalKey(Argument),
});
const Options = Schema.Struct({
  scorer: Schema.optionalKey(Schema.NonEmptyString),
  textScoreAs: Schema.optionalKey(Argument),
  combine: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal("RRF"),
        constant: Schema.optionalKey(Finite.check(Schema.isGreaterThan(0))),
        window: Schema.optionalKey(Positive),
      }),
      Schema.Struct({
        _tag: Schema.Literal("Linear"),
        weights: Schema.optionalKey(Schema.Tuple([Finite, Finite])),
        window: Schema.optionalKey(Positive),
      }),
    ]),
  ),
  combinedScoreAs: Schema.optionalKey(Argument),
  params: Schema.optionalKey(Schema.Array(Schema.Tuple([Argument, Argument]))),
  timeoutMillis: Schema.optionalKey(NonNegative),
  limit: Schema.optionalKey(Limit),
  sortBy: Schema.optionalKey(
    Schema.NonEmptyArray(Schema.Struct({ field: Argument, order: Schema.optionalKey(Order) })),
  ),
  noSort: Schema.optionalKey(Schema.Boolean),
  explainScore: Schema.optionalKey(Schema.Boolean),
  format: Schema.optionalKey(Schema.Literals(["STRING", "EXPAND"])),
}).check(Schema.makeFilter((o) => !o.noSort || o.sortBy === undefined));

export const hybridTokens = Effect.fnUntraced(function* (
  query: RedisArgument,
  vector: SearchHybridVector,
  options: SearchHybridOptions,
) {
  const { steps, ...rest } = options;
  const selected = yield* parse(Options, rest);
  const v = yield* parse(Vector, vector);
  const pipeline = yield* aggregateStepTokens(steps ?? []);
  const neighbors = v.neighbors;
  const near =
    neighbors === undefined
      ? []
      : neighbors._tag === "KNN"
        ? [
            "K",
            String(neighbors.count),
            ...(neighbors.efRuntime === undefined
              ? []
              : ["EF_RUNTIME", String(neighbors.efRuntime)]),
            ...(neighbors.shardKRatio === undefined
              ? []
              : ["SHARD_K_RATIO", String(neighbors.shardKRatio)]),
          ]
        : [
            "RADIUS",
            String(neighbors.radius),
            ...(neighbors.epsilon === undefined ? [] : ["EPSILON", String(neighbors.epsilon)]),
          ];
  const filter =
    v.filter === undefined
      ? []
      : [
          v.filter.expression,
          ...(v.filter.policy === undefined ? [] : ["POLICY", v.filter.policy]),
          ...(v.filter.batchSize === undefined ? [] : ["BATCH_SIZE", String(v.filter.batchSize)]),
        ];
  const method = selected.combine;
  const combination =
    method === undefined
      ? []
      : [
          ...(method._tag === "RRF"
            ? method.constant === undefined
              ? []
              : ["CONSTANT", String(method.constant)]
            : method.weights === undefined
              ? []
              : ["ALPHA", String(method.weights[0]), "BETA", String(method.weights[1])]),
          ...(method.window === undefined ? [] : ["WINDOW", String(method.window)]),
        ];

  return [
    "SEARCH",
    query,
    ...(selected.scorer === undefined ? [] : ["SCORER", selected.scorer]),
    ...(selected.textScoreAs === undefined ? [] : ["YIELD_SCORE_AS", selected.textScoreAs]),
    "VSIM",
    v.field,
    v.vector,
    ...(neighbors === undefined
      ? []
      : [neighbors._tag === "KNN" ? "KNN" : "RANGE", String(near.length), ...near]),
    ...(v.filter === undefined ? [] : ["FILTER", String(filter.length), ...filter]),
    ...(v.yieldScoreAs === undefined ? [] : ["YIELD_SCORE_AS", v.yieldScoreAs]),
    ...(method === undefined
      ? []
      : [
          "COMBINE",
          method._tag === "RRF" ? "RRF" : "LINEAR",
          String(combination.length),
          ...combination,
        ]),
    ...(selected.combinedScoreAs === undefined ? [] : ["YIELD_SCORE_AS", selected.combinedScoreAs]),
    ...(selected.params === undefined
      ? []
      : [
          "PARAMS",
          String(selected.params.length * 2),
          ...selected.params.flatMap(([name, value]) => [name, value]),
        ]),
    ...(selected.timeoutMillis === undefined ? [] : ["TIMEOUT", String(selected.timeoutMillis)]),
    ...(selected.limit === undefined
      ? []
      : ["LIMIT", String(selected.limit.offset), String(selected.limit.count)]),
    ...(selected.sortBy === undefined
      ? []
      : [
          "SORTBY",
          ...selected.sortBy.flatMap((field) => [
            field.field,
            ...(field.order === undefined ? [] : [field.order]),
          ]),
        ]),
    ...(selected.noSort ? ["NOSORT"] : []),
    ...(selected.explainScore ? ["EXPLAINSCORE"] : []),
    ...(selected.format === undefined ? [] : ["FORMAT", selected.format]),
    ...pipeline,
  ];
});
const hybridResult: ReplyDecoder<SearchAggregateResult> = (reply) =>
  Effect.gen(function* () {
    const report = yield* fields(reply);
    const total = report.find(([key]) => key === "total_results")?.[1];
    const rows = report.find(([key]) => key === "results")?.[1];
    if (total === undefined || rows === undefined) return yield* mismatch("custom", reply);
    return {
      total: yield* unsigned(total),
      rows: yield* array(searchFields)(rows),
      metadata: report.filter(([key]) => !["results", "total_results"].includes(key)),
    };
  });
export const ftHybrid = (
  index: RedisArgument,
  query: RedisArgument,
  vector: SearchHybridVector,
  options: SearchHybridOptions = {},
) =>
  moduleKeyless(
    "search",
    "FT.HYBRID",
    hybridResult,
    hybridTokens(query, vector, options).pipe(Effect.map((tokens) => [index, ...tokens])),
  );
const hybridProfile: ReplyDecoder<SearchProfile<SearchAggregateResult>> = (reply) => {
  const value = undecorate(reply);
  // Redis8.10 RESP2 appends the profile to its flat named result envelope.
  if (value._tag === "Array" && value.values.length > 2 && value.values.length % 2 === 1) {
    const profile = value.values.at(-1);
    if (profile === undefined) return Effect.fail(mismatch("array", reply));
    return hybridResult({ _tag: "Array", values: value.values.slice(0, -1) }).pipe(
      Effect.map((result) => ({ result, profile })),
    );
  }
  return profileResult(hybridResult)(reply);
};

export const ftProfileHybrid = (
  index: RedisArgument,
  query: RedisArgument,
  vector: SearchHybridVector,
  options: SearchHybridOptions = {},
  profile: { readonly limited?: boolean } = {},
) =>
  moduleKeyless(
    "search",
    "FT.PROFILE",
    hybridProfile,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ limited: Schema.optionalKey(Schema.Boolean) }),
        profile,
      );
      return [
        index,
        "HYBRID",
        ...(selected.limited ? ["LIMITED"] : []),
        "QUERY",
        ...(yield* hybridTokens(query, vector, options)),
      ];
    }),
  );
