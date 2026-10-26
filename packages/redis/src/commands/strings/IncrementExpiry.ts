import { Effect, Schema } from "effect";

import { decimalToken, tuple } from "#/command/reply/Data";
import { integer as integerReply } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { Expiry, expiryTokens } from "#/commands/internal/Expiry";
import { Decimal, Integer, parse } from "#/commands/internal/Input";
import { catalog } from "#/commands/strings/Catalog";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

const IntegerOptions = Schema.Struct({
  increment: Schema.optionalKey(Integer),
  lower: Schema.optionalKey(Integer),
  upper: Schema.optionalKey(Integer),
  saturate: Schema.optionalKey(Schema.Boolean),
  expiry: Schema.optionalKey(Expiry),
  onlyWithoutExpiry: Schema.optionalKey(Schema.Boolean),
});

const FloatOptions = Schema.Struct({
  increment: Decimal,
  lower: Schema.optionalKey(Decimal),
  upper: Schema.optionalKey(Decimal),
  saturate: Schema.optionalKey(Schema.Boolean),
  expiry: Schema.optionalKey(Expiry),
  onlyWithoutExpiry: Schema.optionalKey(Schema.Boolean),
});

export type IncrementExpiryOptions = typeof IntegerOptions.Type;
export type FloatIncrementExpiryOptions = typeof FloatOptions.Type;

const expiry = (options: { readonly expiry?: Expiry; readonly onlyWithoutExpiry?: boolean }) =>
  Effect.gen(function* () {
    if (
      options.onlyWithoutExpiry &&
      (options.expiry === undefined || options.expiry.type === "PERSIST")
    )
      return yield* new CommandInputError({ delivery: "unsent", reason: "options" });

    return [
      ...(yield* expiryTokens(options.expiry)),
      ...(options.onlyWithoutExpiry ? ["ENX"] : []),
    ];
  });

export const increx = (key: RedisArgument, options: IncrementExpiryOptions = {}) =>
  keyed(
    catalog.INCREX,
    key,
    Effect.gen(function* () {
      const parsed = yield* parse(IntegerOptions, options);
      const tokens: RedisArgument[] = ["BYINT", String(parsed.increment ?? 1)];

      if (parsed.lower !== undefined) tokens.push("LBOUND", String(parsed.lower));
      if (parsed.upper !== undefined) tokens.push("UBOUND", String(parsed.upper));
      if (parsed.saturate) tokens.push("SATURATE");

      return [...tokens, ...(yield* expiry(parsed))];
    }),
    tuple(integerReply, integerReply),
    "read-write",
  );

/** Float results remain decimal tokens; integer mode has an exact bigint tuple. */
export const increxFloat = (key: RedisArgument, options: FloatIncrementExpiryOptions) =>
  keyed(
    catalog.INCREX,
    key,
    Effect.gen(function* () {
      const parsed = yield* parse(FloatOptions, options);
      const tokens: RedisArgument[] = ["BYFLOAT", String(parsed.increment)];

      if (parsed.lower !== undefined) tokens.push("LBOUND", String(parsed.lower));
      if (parsed.upper !== undefined) tokens.push("UBOUND", String(parsed.upper));
      if (parsed.saturate) tokens.push("SATURATE");

      return [...tokens, ...(yield* expiry(parsed))];
    }),
    tuple(decimalToken, decimalToken),
    "read-write",
  );
