import { Effect, Schema } from "effect";

import { Argument, Integer, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export type Score = number | string;
export const Score = Schema.Union([
  Schema.Number.check(Schema.makeFilter((value) => !Number.isNaN(value))),
  Schema.String.check(
    Schema.isPattern(/^(?:[+-]?inf|[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/),
    Schema.makeFilter((value) => /^[+-]?inf$/.test(value) || Number.isFinite(Number(value))),
  ),
]);

export const score = (value: Score) =>
  parse(Score, value).pipe(
    Effect.map((parsed) =>
      parsed === Infinity ? "+inf" : parsed === -Infinity ? "-inf" : String(parsed),
    ),
  );

const ScoreBoundSchema = Schema.Union([Score, Schema.Struct({ exclusive: Score })]);
export type ScoreBound = Score | { readonly exclusive: Score };

export const scoreBound = (value: ScoreBound) =>
  parse(ScoreBoundSchema, value).pipe(
    Effect.flatMap((bound) =>
      typeof bound === "object"
        ? score(bound.exclusive).pipe(Effect.map((token) => `(${token}`))
        : score(bound),
    ),
  );

const LexBoundSchema = Schema.Union([
  Schema.Literals(["-", "+"]),
  Schema.Struct({ value: Argument, exclusive: Schema.optionalKey(Schema.Boolean) }),
]);
export type LexBound = "-" | "+" | { readonly value: RedisArgument; readonly exclusive?: boolean };

export const lexBound = (value: LexBound) =>
  parse(LexBoundSchema, value).pipe(
    Effect.map((bound): RedisArgument => {
      if (typeof bound === "string") return bound;
      const marker = bound.exclusive ? "(" : "[";
      if (typeof bound.value === "string") return marker + bound.value;

      const bytes = new Uint8Array(bound.value.length + 1);
      bytes[0] = marker.charCodeAt(0);
      bytes.set(bound.value, 1);
      return bytes;
    }),
  );

// Negative offsets are valid server input and produce an empty sorted range.
export const Limit = Schema.Struct({ offset: Integer, count: Integer });
export type RangeLimit = typeof Limit.Type;

export const limit = (value: RangeLimit | undefined) =>
  value === undefined
    ? Effect.succeed([])
    : parse(Limit, value).pipe(
        Effect.map((parsed) => ["LIMIT", String(parsed.offset), String(parsed.count)]),
      );
