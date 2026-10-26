import { Effect, Schema } from "effect";

import { parse } from "#/commands/internal/Input";

export type ArrayIndex = number | bigint;
export const ArrayIndex = Schema.Union([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 18446744073709551615n })),
]);

export const index = (value: ArrayIndex) => parse(ArrayIndex, value).pipe(Effect.map(String));
