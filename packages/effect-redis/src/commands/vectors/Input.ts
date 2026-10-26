import { Effect, Schema } from "effect";

import { Argument, Finite, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export type VectorInput =
  | { readonly _tag: "Values"; readonly coordinates: readonly [number, ...number[]] }
  | { readonly _tag: "FP32"; readonly bytes: Uint8Array };

export type VectorQuery =
  | VectorInput
  | { readonly _tag: "Element"; readonly element: RedisArgument };

const Input = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Values"),
    coordinates: Schema.NonEmptyArray(
      Finite.check(Schema.makeFilter((n) => Number.isFinite(Math.fround(n)))),
    ),
  }),
  Schema.Struct({
    _tag: Schema.Literal("FP32"),
    bytes: Schema.Uint8Array.check(Schema.makeFilter((b) => b.length > 0 && b.length % 4 === 0)),
  }),
]);

const Query = Schema.Union([
  Input,
  Schema.Struct({ _tag: Schema.Literal("Element"), element: Argument }),
]);

export const vectorTokens = (input: VectorInput) =>
  parse(Input, input).pipe(
    Effect.map((selected): ReadonlyArray<RedisArgument> =>
      selected._tag === "FP32"
        ? ["FP32", selected.bytes]
        : ["VALUES", String(selected.coordinates.length), ...selected.coordinates.map(String)],
    ),
  );

export const queryTokens = (query: VectorQuery) =>
  parse(Query, query).pipe(
    Effect.flatMap((selected) =>
      selected._tag === "Element"
        ? Effect.succeed<ReadonlyArray<RedisArgument>>(["ELE", selected.element])
        : vectorTokens(selected),
    ),
  );
