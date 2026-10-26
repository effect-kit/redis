import { Effect, Schema } from "effect";

import { CommandInputError } from "#/errors/CommandInputError";

export type Integer = number | bigint;

export const Argument = Schema.Union([Schema.String, Schema.Uint8Array]);
export const Arguments = Schema.NonEmptyArray(Argument);
export const Pairs = Schema.NonEmptyArray(Schema.Tuple([Argument, Argument]));

export const Integer = Schema.Union([
  Schema.Int.check(
    Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  Schema.BigInt.check(
    Schema.isGreaterThanOrEqualToBigInt(-9223372036854775808n),
    Schema.isLessThanOrEqualToBigInt(9223372036854775807n),
  ),
]);
export const NonNegative = Integer.check(Schema.makeFilter((n) => n >= 0));
export const Positive = Integer.check(Schema.makeFilter((n) => n > 0));
export const Finite = Schema.Number.check(Schema.isFinite());

export const parse = <S extends Schema.Constraint>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "arguments" })),
  );

export const integer = (value: Integer) => parse(Integer, value).pipe(Effect.map(String));
export const positive = (value: Integer) => parse(Positive, value).pipe(Effect.map(String));
export const nonNegative = (value: Integer) => parse(NonNegative, value).pipe(Effect.map(String));
export const finite = (value: number) => parse(Finite, value).pipe(Effect.map(String));

export type Decimal = number | string;

export const Decimal = Schema.Union([
  Finite,
  Schema.String.check(
    Schema.isPattern(/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/),
  ),
]);

export const decimal = (value: Decimal) => parse(Decimal, value).pipe(Effect.map(String));
