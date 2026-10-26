import { Effect, Schema } from "effect";

import { integer, status } from "#/command/reply/Scalars";
import { Argument, Arguments, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import {
  CommonOptions,
  Limit,
  Order,
  ReturnField,
  commonTokens,
  returnTokens,
} from "#/commands/search/query/Options";
import type { SearchCommonOptions, SearchReturnField } from "#/commands/search/query/Options";
import { aggregateCursor, aggregateResult } from "#/commands/search/reply/Aggregate";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchReducer {
  readonly function:
    | "COUNT"
    | "COUNT_DISTINCT"
    | "COUNT_DISTINCTISH"
    | "SUM"
    | "MIN"
    | "MAX"
    | "AVG"
    | "STDDEV"
    | "QUANTILE"
    | "TOLIST"
    | "FIRST_VALUE"
    | "RANDOM_SAMPLE";
  readonly args?: ReadonlyArray<RedisArgument>;
  readonly as?: RedisArgument;
}
export interface SearchCollectReducer {
  readonly function: "COLLECT";
  readonly fields: "*" | readonly [RedisArgument, ...RedisArgument[]];
  readonly sortBy?: ReadonlyArray<{
    readonly field: RedisArgument;
    readonly order?: "ASC" | "DESC";
  }>;
  readonly limit?: { readonly offset: Integer; readonly count: Integer };
  readonly distinct?: boolean;
  readonly as?: RedisArgument;
}
export type SearchAggregateStep =
  | { readonly _tag: "Load"; readonly fields: "*" | ReadonlyArray<SearchReturnField> }
  | {
      readonly _tag: "GroupBy";
      readonly fields: ReadonlyArray<RedisArgument>;
      readonly reducers?: ReadonlyArray<SearchReducer | SearchCollectReducer>;
    }
  | {
      readonly _tag: "SortBy";
      readonly fields: readonly [
        { readonly field: RedisArgument; readonly order?: "ASC" | "DESC" },
        ...Array<{ readonly field: RedisArgument; readonly order?: "ASC" | "DESC" }>,
      ];
      readonly max?: Integer;
    }
  | { readonly _tag: "Apply"; readonly expression: RedisArgument; readonly as: RedisArgument }
  | { readonly _tag: "Filter"; readonly expression: RedisArgument }
  | { readonly _tag: "Limit"; readonly offset: Integer; readonly count: Integer };
const SortField = Schema.Struct({ field: Argument, order: Schema.optionalKey(Order) });
const Reducer = Schema.Union([
  Schema.Struct({
    function: Schema.Literals([
      "COUNT",
      "COUNT_DISTINCT",
      "COUNT_DISTINCTISH",
      "SUM",
      "MIN",
      "MAX",
      "AVG",
      "STDDEV",
      "QUANTILE",
      "TOLIST",
      "FIRST_VALUE",
      "RANDOM_SAMPLE",
    ]),
    args: Schema.optionalKey(Schema.Array(Argument)),
    as: Schema.optionalKey(Argument),
  }),
  Schema.Struct({
    function: Schema.Literal("COLLECT"),
    fields: Schema.Union([Schema.Literal("*"), Arguments]),
    sortBy: Schema.optionalKey(Schema.Array(SortField)),
    limit: Schema.optionalKey(Limit),
    distinct: Schema.optionalKey(Schema.Boolean),
    as: Schema.optionalKey(Argument),
  }),
]);
const Step = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Load"),
    fields: Schema.Union([Schema.Literal("*"), Schema.Array(ReturnField)]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("GroupBy"),
    fields: Schema.Array(Argument),
    reducers: Schema.optionalKey(Schema.Array(Reducer)),
  }),
  Schema.Struct({
    _tag: Schema.Literal("SortBy"),
    fields: Schema.NonEmptyArray(SortField),
    max: Schema.optionalKey(NonNegative),
  }),
  Schema.Struct({ _tag: Schema.Literal("Apply"), expression: Argument, as: Argument }),
  Schema.Struct({ _tag: Schema.Literal("Filter"), expression: Argument }),
  Schema.Struct({ _tag: Schema.Literal("Limit"), offset: NonNegative, count: NonNegative }),
]);
const sorts = (
  fields: ReadonlyArray<{ readonly field: RedisArgument; readonly order?: "ASC" | "DESC" }>,
) => fields.flatMap((field) => [field.field, ...(field.order === undefined ? [] : [field.order])]);
const reducerTokens = (
  reducer: SearchReducer | SearchCollectReducer,
): ReadonlyArray<RedisArgument> => {
  const order =
    reducer.function === "COLLECT" && reducer.sortBy !== undefined
      ? sorts(reducer.sortBy)
      : undefined;
  const args =
    reducer.function === "COLLECT"
      ? [
          "FIELDS",
          ...(reducer.fields === "*" ? ["*"] : [String(reducer.fields.length), ...reducer.fields]),
          ...(order === undefined ? [] : ["SORTBY", String(order.length), ...order]),
          ...(reducer.limit === undefined
            ? []
            : ["LIMIT", String(reducer.limit.offset), String(reducer.limit.count)]),
          ...(reducer.distinct ? ["DISTINCT"] : []),
        ]
      : (reducer.args ?? []);
  return [
    "REDUCE",
    reducer.function,
    String(args.length),
    ...args,
    ...(reducer.as === undefined ? [] : ["AS", reducer.as]),
  ];
};

export const aggregateStepTokens = (steps: ReadonlyArray<SearchAggregateStep>) =>
  parse(Schema.Array(Step), steps).pipe(
    Effect.map((selected) =>
      selected.flatMap((step): ReadonlyArray<RedisArgument> => {
        switch (step._tag) {
          case "Load": {
            const fields = step.fields === "*" ? undefined : returnTokens(step.fields);
            return fields === undefined
              ? ["LOAD", "*"]
              : ["LOAD", String(fields.length), ...fields];
          }
          case "GroupBy":
            return [
              "GROUPBY",
              String(step.fields.length),
              ...step.fields,
              ...(step.reducers ?? []).flatMap(reducerTokens),
            ];
          case "SortBy": {
            const fields = sorts(step.fields);
            return [
              "SORTBY",
              String(fields.length),
              ...fields,
              ...(step.max === undefined ? [] : ["MAX", String(step.max)]),
            ];
          }
          case "Apply":
            return ["APPLY", step.expression, "AS", step.as];
          case "Filter":
            return ["FILTER", step.expression];
          case "Limit":
            return ["LIMIT", String(step.offset), String(step.count)];
        }
      }),
    ),
  );
export interface SearchAggregateOptions extends SearchCommonOptions {
  readonly steps?: ReadonlyArray<SearchAggregateStep>;
}
export interface SearchCursorOptions {
  readonly count?: Integer;
  readonly maxIdleMillis?: Integer;
}
export const aggregateTokens = Effect.fnUntraced(function* (options: SearchAggregateOptions) {
  const selected = yield* parse(
    Schema.Struct({ ...CommonOptions, steps: Schema.optionalKey(Schema.Array(Step)) }),
    options,
  );
  const steps = yield* aggregateStepTokens(selected.steps ?? []);
  return [...steps, ...commonTokens(selected)];
});
export const ftAggregate = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchAggregateOptions = {},
) =>
  moduleKeyless(
    "search",
    "FT.AGGREGATE",
    aggregateResult,
    aggregateTokens(options).pipe(Effect.map((tokens) => [index, query, ...tokens])),
  );
export const ftAggregateWithCursor = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchAggregateOptions = {},
  cursor: SearchCursorOptions = {},
) =>
  moduleKeyless(
    "search",
    "FT.AGGREGATE",
    aggregateCursor,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          count: Schema.optionalKey(Positive),
          maxIdleMillis: Schema.optionalKey(Positive),
        }),
        cursor,
      );
      return [
        index,
        query,
        ...(yield* aggregateTokens(options)),
        "WITHCURSOR",
        ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
        ...(selected.maxIdleMillis === undefined
          ? []
          : ["MAXIDLE", String(selected.maxIdleMillis)]),
      ];
    }),
  );
export const ftCursorRead = (index: RedisArgument, cursor: Integer, count?: Integer) =>
  moduleKeyless(
    "search",
    "FT.CURSOR READ",
    aggregateCursor,
    Effect.gen(function* () {
      const id = yield* parse(Positive, cursor);
      const selected = count === undefined ? undefined : yield* parse(Positive, count);
      return [index, String(id), ...(selected === undefined ? [] : ["COUNT", String(selected)])];
    }),
  );
export const ftCursorDel = (index: RedisArgument, cursor: Integer) =>
  moduleKeyless(
    "search",
    "FT.CURSOR DEL",
    status("OK"),
    parse(Positive, cursor).pipe(Effect.map((id) => [index, String(id)])),
  );

/** The pinned coordinator requires a fourth compatibility token; GC collects expired cursors server-wide. */
export const ftCursorGc = (index: RedisArgument) =>
  moduleKeyless("search", "FT.CURSOR GC", integer, Effect.succeed([index, "0"]));
