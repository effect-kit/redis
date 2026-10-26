import { Effect, Schema } from "effect";

import {
  Argument,
  Arguments,
  Decimal,
  Finite,
  NonNegative,
  Positive,
  parse,
} from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchCommonOptions {
  readonly params?: ReadonlyArray<readonly [RedisArgument, RedisArgument]>;
  readonly dialect?: Integer;
  readonly timeoutMillis?: Integer;
  readonly verbatim?: boolean;
}
export const CommonOptions = {
  params: Schema.optionalKey(Schema.Array(Schema.Tuple([Argument, Argument]))),
  dialect: Schema.optionalKey(Positive),
  timeoutMillis: Schema.optionalKey(NonNegative),
  verbatim: Schema.optionalKey(Schema.Boolean),
};
export const commonTokens = (selected: SearchCommonOptions): ReadonlyArray<RedisArgument> => [
  ...(selected.verbatim ? ["VERBATIM"] : []),
  ...(selected.timeoutMillis === undefined ? [] : ["TIMEOUT", String(selected.timeoutMillis)]),
  ...(selected.params === undefined
    ? []
    : [
        "PARAMS",
        String(selected.params.length * 2),
        ...selected.params.flatMap(([name, value]) => [name, value]),
      ]),
  ...(selected.dialect === undefined ? [] : ["DIALECT", String(selected.dialect)]),
];
export interface SearchReturnField {
  readonly field: RedisArgument;
  readonly as?: RedisArgument;
}
export const ReturnField = Schema.Struct({ field: Argument, as: Schema.optionalKey(Argument) });
export const returnTokens = (fields: ReadonlyArray<SearchReturnField>) =>
  fields.flatMap((field) => [field.field, ...(field.as === undefined ? [] : ["AS", field.as])]);
export interface SearchOptions extends SearchCommonOptions {
  readonly noContent?: boolean;
  readonly noStopWords?: boolean;
  readonly withScores?: boolean;
  readonly explainScore?: boolean;
  readonly withPayloads?: boolean;
  readonly withSortKeys?: boolean;
  readonly filters?: ReadonlyArray<{
    readonly field: RedisArgument;
    readonly min: string | number;
    readonly max: string | number;
  }>;
  readonly geoFilters?: ReadonlyArray<{
    readonly field: RedisArgument;
    readonly longitude: number;
    readonly latitude: number;
    readonly radius: number;
    readonly unit: "m" | "km" | "mi" | "ft";
  }>;
  readonly inKeys?: readonly [RedisArgument, ...RedisArgument[]];
  readonly inFields?: readonly [RedisArgument, ...RedisArgument[]];
  readonly returnFields?: ReadonlyArray<SearchReturnField>;
  readonly summarize?: {
    readonly fields?: readonly [RedisArgument, ...RedisArgument[]];
    readonly fragments?: Integer;
    readonly length?: Integer;
    readonly separator?: RedisArgument;
  };
  readonly highlight?: {
    readonly fields?: readonly [RedisArgument, ...RedisArgument[]];
    readonly tags?: readonly [RedisArgument, RedisArgument];
  };
  readonly slop?: Integer;
  readonly inOrder?: boolean;
  readonly language?: string;
  readonly expander?: string;
  readonly scorer?: string;
  readonly payload?: RedisArgument;
  readonly sortBy?: { readonly field: RedisArgument; readonly order?: "ASC" | "DESC" };
  readonly limit?: { readonly offset: Integer; readonly count: Integer };
  readonly format?: "STRING" | "EXPAND";
}
const Boundary = Schema.Union([
  Decimal,
  Schema.String.check(
    Schema.isPattern(/^(?:[+-]?inf|\([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/),
  ),
]);
export const Limit = Schema.Struct({ offset: NonNegative, count: NonNegative });
export const Order = Schema.Literals(["ASC", "DESC"]);
export const SearchOptions = Schema.Struct({
  ...CommonOptions,
  noContent: Schema.optionalKey(Schema.Boolean),
  noStopWords: Schema.optionalKey(Schema.Boolean),
  withScores: Schema.optionalKey(Schema.Boolean),
  explainScore: Schema.optionalKey(Schema.Boolean),
  withPayloads: Schema.optionalKey(Schema.Boolean),
  withSortKeys: Schema.optionalKey(Schema.Boolean),
  filters: Schema.optionalKey(
    Schema.Array(Schema.Struct({ field: Argument, min: Boundary, max: Boundary })),
  ),
  geoFilters: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Argument,
        longitude: Finite,
        latitude: Finite,
        radius: Finite.check(Schema.isGreaterThan(0)),
        unit: Schema.Literals(["m", "km", "mi", "ft"]),
      }),
    ),
  ),
  inKeys: Schema.optionalKey(Arguments),
  inFields: Schema.optionalKey(Arguments),
  returnFields: Schema.optionalKey(Schema.Array(ReturnField)),
  summarize: Schema.optionalKey(
    Schema.Struct({
      fields: Schema.optionalKey(Arguments),
      fragments: Schema.optionalKey(Positive),
      length: Schema.optionalKey(Positive),
      separator: Schema.optionalKey(Argument),
    }),
  ),
  highlight: Schema.optionalKey(
    Schema.Struct({
      fields: Schema.optionalKey(Arguments),
      tags: Schema.optionalKey(Schema.Tuple([Argument, Argument])),
    }),
  ),
  slop: Schema.optionalKey(NonNegative),
  inOrder: Schema.optionalKey(Schema.Boolean),
  language: Schema.optionalKey(Schema.NonEmptyString),
  expander: Schema.optionalKey(Schema.NonEmptyString),
  scorer: Schema.optionalKey(Schema.NonEmptyString),
  payload: Schema.optionalKey(Argument),
  sortBy: Schema.optionalKey(Schema.Struct({ field: Argument, order: Schema.optionalKey(Order) })),
  limit: Schema.optionalKey(Limit),
  format: Schema.optionalKey(Schema.Literals(["STRING", "EXPAND"])),
}).check(Schema.makeFilter((o) => !o.explainScore || o.withScores === true));

export const searchTokens = Effect.fnUntraced(function* (options: SearchOptions) {
  const selected = yield* parse(SearchOptions, options);
  const projection =
    selected.returnFields === undefined ? undefined : returnTokens(selected.returnFields);
  const summary = selected.summarize;
  const highlight = selected.highlight;

  return {
    selected,
    tokens: [
      ...commonTokens(selected),
      ...(selected.noContent ? ["NOCONTENT"] : []),
      ...(selected.noStopWords ? ["NOSTOPWORDS"] : []),
      ...(selected.withScores ? ["WITHSCORES"] : []),
      ...(selected.explainScore ? ["EXPLAINSCORE"] : []),
      ...(selected.withPayloads ? ["WITHPAYLOADS"] : []),
      ...(selected.withSortKeys ? ["WITHSORTKEYS"] : []),
      ...(selected.filters ?? []).flatMap((filter) => [
        "FILTER",
        filter.field,
        String(filter.min),
        String(filter.max),
      ]),
      ...(selected.geoFilters ?? []).flatMap((filter) => [
        "GEOFILTER",
        filter.field,
        String(filter.longitude),
        String(filter.latitude),
        String(filter.radius),
        filter.unit,
      ]),
      ...(selected.inKeys === undefined
        ? []
        : ["INKEYS", String(selected.inKeys.length), ...selected.inKeys]),
      ...(selected.inFields === undefined
        ? []
        : ["INFIELDS", String(selected.inFields.length), ...selected.inFields]),
      ...(projection === undefined ? [] : ["RETURN", String(projection.length), ...projection]),
      ...(summary === undefined
        ? []
        : [
            "SUMMARIZE",
            ...(summary.fields === undefined
              ? []
              : ["FIELDS", String(summary.fields.length), ...summary.fields]),
            ...(summary.fragments === undefined ? [] : ["FRAGS", String(summary.fragments)]),
            ...(summary.length === undefined ? [] : ["LEN", String(summary.length)]),
            ...(summary.separator === undefined ? [] : ["SEPARATOR", summary.separator]),
          ]),
      ...(highlight === undefined
        ? []
        : [
            "HIGHLIGHT",
            ...(highlight.fields === undefined
              ? []
              : ["FIELDS", String(highlight.fields.length), ...highlight.fields]),
            ...(highlight.tags === undefined ? [] : ["TAGS", ...highlight.tags]),
          ]),
      ...(selected.slop === undefined ? [] : ["SLOP", String(selected.slop)]),
      ...(selected.inOrder ? ["INORDER"] : []),
      ...(selected.language === undefined ? [] : ["LANGUAGE", selected.language]),
      ...(selected.expander === undefined ? [] : ["EXPANDER", selected.expander]),
      ...(selected.scorer === undefined ? [] : ["SCORER", selected.scorer]),
      ...(selected.payload === undefined ? [] : ["PAYLOAD", selected.payload]),
      ...(selected.sortBy === undefined
        ? []
        : [
            "SORTBY",
            selected.sortBy.field,
            ...(selected.sortBy.order === undefined ? [] : [selected.sortBy.order]),
          ]),
      ...(selected.limit === undefined
        ? []
        : ["LIMIT", String(selected.limit.offset), String(selected.limit.count)]),
      ...(selected.format === undefined ? [] : ["FORMAT", selected.format]),
    ] satisfies ReadonlyArray<RedisArgument>,
  };
});
