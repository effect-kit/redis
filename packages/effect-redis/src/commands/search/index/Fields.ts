import { Effect, Schema } from "effect";

import { Argument, Finite, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

interface FieldBase {
  readonly field: RedisArgument;
  readonly as?: RedisArgument;
  readonly sortable?: boolean | "UNF";
  readonly noIndex?: boolean;
  readonly indexEmpty?: boolean;
  readonly indexMissing?: boolean;
  readonly withSuffixTrie?: boolean;
}
export type SearchField = FieldBase &
  (
    | {
        readonly type: "TEXT";
        readonly weight?: number;
        readonly noStem?: boolean;
        readonly phonetic?: string;
      }
    | { readonly type: "TAG"; readonly separator?: string; readonly caseSensitive?: boolean }
    | { readonly type: "NUMERIC" | "GEO" }
    | { readonly type: "GEOSHAPE"; readonly coordinateSystem?: "FLAT" | "SPHERICAL" }
    | {
        readonly type: "VECTOR";
        readonly algorithm: "FLAT" | "HNSW" | "SVS-VAMANA";
        readonly attributes: SearchVectorAttributes;
      }
  );
export interface SearchVectorAttributes {
  readonly dataType: "FLOAT32" | "FLOAT64" | "FLOAT16" | "BFLOAT16" | "INT8" | "UINT8";
  readonly dimensions: Integer;
  readonly distanceMetric: "L2" | "IP" | "COSINE";
  readonly initialCapacity?: Integer;
  readonly blockSize?: Integer;
  readonly connections?: Integer;
  readonly efConstruction?: Integer;
  readonly efRuntime?: Integer;
  readonly epsilon?: number;
  readonly compression?: string;
  readonly graphMaxDegree?: Integer;
  readonly constructionWindowSize?: Integer;
  readonly searchWindowSize?: Integer;
  readonly trainingThreshold?: Integer;
  readonly leanvecDimensions?: Integer;
}
const Base = {
  field: Argument,
  as: Schema.optionalKey(Argument),
  sortable: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Literal("UNF")])),
  noIndex: Schema.optionalKey(Schema.Boolean),
  indexEmpty: Schema.optionalKey(Schema.Boolean),
  indexMissing: Schema.optionalKey(Schema.Boolean),
  withSuffixTrie: Schema.optionalKey(Schema.Boolean),
};
const VectorAttributes = Schema.Struct({
  dataType: Schema.Literals(["FLOAT32", "FLOAT64", "FLOAT16", "BFLOAT16", "INT8", "UINT8"]),
  dimensions: Positive,
  distanceMetric: Schema.Literals(["L2", "IP", "COSINE"]),
  initialCapacity: Schema.optionalKey(Positive),
  blockSize: Schema.optionalKey(Positive),
  connections: Schema.optionalKey(Positive),
  efConstruction: Schema.optionalKey(Positive),
  efRuntime: Schema.optionalKey(Positive),
  epsilon: Schema.optionalKey(Finite.check(Schema.isGreaterThan(0))),
  compression: Schema.optionalKey(Schema.NonEmptyString),
  graphMaxDegree: Schema.optionalKey(Positive),
  constructionWindowSize: Schema.optionalKey(Positive),
  searchWindowSize: Schema.optionalKey(Positive),
  trainingThreshold: Schema.optionalKey(Positive),
  leanvecDimensions: Schema.optionalKey(Positive),
});
const Field = Schema.Union([
  Schema.Struct({
    ...Base,
    type: Schema.Literal("TEXT"),
    weight: Schema.optionalKey(Finite.check(Schema.isGreaterThan(0))),
    noStem: Schema.optionalKey(Schema.Boolean),
    phonetic: Schema.optionalKey(Schema.NonEmptyString),
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("TAG"),
    separator: Schema.optionalKey(Schema.String),
    caseSensitive: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ ...Base, type: Schema.Literals(["NUMERIC", "GEO"]) }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("GEOSHAPE"),
    coordinateSystem: Schema.optionalKey(Schema.Literals(["FLAT", "SPHERICAL"])),
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("VECTOR"),
    algorithm: Schema.Literals(["FLAT", "HNSW", "SVS-VAMANA"]),
    attributes: VectorAttributes,
  }),
]);
const vectorAttributeNames = [
  ["dataType", "TYPE"],
  ["dimensions", "DIM"],
  ["distanceMetric", "DISTANCE_METRIC"],
  ["initialCapacity", "INITIAL_CAP"],
  ["blockSize", "BLOCK_SIZE"],
  ["connections", "M"],
  ["efConstruction", "EF_CONSTRUCTION"],
  ["efRuntime", "EF_RUNTIME"],
  ["epsilon", "EPSILON"],
  ["compression", "COMPRESSION"],
  ["graphMaxDegree", "GRAPH_MAX_DEGREE"],
  ["constructionWindowSize", "CONSTRUCTION_WINDOW_SIZE"],
  ["searchWindowSize", "SEARCH_WINDOW_SIZE"],
  ["trainingThreshold", "TRAINING_THRESHOLD"],
  ["leanvecDimensions", "REDUCE"],
] as const;

export const fieldTokens = Effect.fnUntraced(function* (
  fields: readonly [SearchField, ...SearchField[]],
) {
  const selected = yield* parse(Schema.NonEmptyArray(Field), fields);
  return selected.flatMap((field): ReadonlyArray<RedisArgument> => {
    const tokens: RedisArgument[] = [field.field];
    if (field.as !== undefined) tokens.push("AS", field.as);
    tokens.push(field.type);

    if (field.type === "TEXT")
      tokens.push(
        ...(field.weight === undefined ? [] : ["WEIGHT", String(field.weight)]),
        ...(field.noStem ? ["NOSTEM"] : []),
        ...(field.phonetic === undefined ? [] : ["PHONETIC", field.phonetic]),
      );
    if (field.type === "TAG")
      tokens.push(
        ...(field.separator === undefined ? [] : ["SEPARATOR", field.separator]),
        ...(field.caseSensitive ? ["CASESENSITIVE"] : []),
      );
    if (field.type === "GEOSHAPE" && field.coordinateSystem !== undefined)
      tokens.push(field.coordinateSystem);
    if (field.type === "VECTOR") {
      const attributes = vectorAttributeNames.flatMap(([name, token]) =>
        field.attributes[name] === undefined ? [] : [token, String(field.attributes[name])],
      );
      tokens.push(field.algorithm, String(attributes.length), ...attributes);
    }
    tokens.push(
      ...(field.withSuffixTrie ? ["WITHSUFFIXTRIE"] : []),
      ...(field.indexEmpty ? ["INDEXEMPTY"] : []),
      ...(field.indexMissing ? ["INDEXMISSING"] : []),
      ...(field.sortable ? ["SORTABLE", ...(field.sortable === "UNF" ? ["UNF"] : [])] : []),
      ...(field.noIndex ? ["NOINDEX"] : []),
    );
    return tokens;
  });
});
