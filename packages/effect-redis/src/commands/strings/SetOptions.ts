import { Duration, Effect, Schema } from "effect";
import type { Option } from "effect";

import { PositiveInteger } from "#/config/Validation";
import { CommandInputError } from "#/errors/CommandInputError";

const Argument = Schema.Union([Schema.String, Schema.Uint8Array]);
const PositiveInt64 = Schema.Union([
  PositiveInteger,
  Schema.BigInt.check(
    Schema.isGreaterThanBigInt(0n),
    Schema.isLessThanOrEqualToBigInt(9223372036854775807n),
  ),
]);
export const SetCondition = Schema.Union([
  Schema.Literals(["NX", "XX"]),
  Schema.Struct({ type: Schema.Literals(["IFEQ", "IFNE"]), value: Argument }),
  Schema.Struct({
    type: Schema.Literals(["IFDEQ", "IFDNE"]),
    digest: Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{16}$/)),
  }),
]);
export type SetCondition = typeof SetCondition.Type;
export const SetExpiry = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["EX", "PX", "EXAT", "PXAT"]), value: PositiveInt64 }),
  Schema.Struct({ type: Schema.Literal("KEEPTTL") }),
]);
export type SetExpiry = typeof SetExpiry.Type;
export const SetOptions = Schema.Struct({
  condition: Schema.optional(SetCondition),
  expiry: Schema.optional(SetExpiry),
  get: Schema.optional(Schema.Boolean),
});
export type SetOptions = typeof SetOptions.Type;
export type WriteSetOptions = Omit<SetOptions, "get"> & { readonly get?: never };
export type WriteSetResult<O> = O extends { readonly condition: SetCondition }
  ? boolean
  : "condition" extends keyof O
    ? O extends { readonly condition?: undefined }
      ? void
      : void | boolean
    : void;
export type SetResult<O extends SetOptions> = O extends { readonly get: true }
  ? Option.Option<Uint8Array>
  : "get" extends keyof O
    ? O extends { readonly get?: false | undefined }
      ? WriteSetResult<O>
      : WriteSetResult<O> | Option.Option<Uint8Array>
    : WriteSetResult<O>;

export const decodeSetOptions = Schema.decodeUnknownEffect(SetOptions, {
  onExcessProperty: "error",
});
export const decodeWriteSetOptions = Schema.decodeUnknownEffect(
  Schema.Struct({
    condition: SetOptions.fields.condition,
    expiry: SetOptions.fields.expiry,
  }),
  { onExcessProperty: "error" },
);
/** Expiry uses whole positive milliseconds; sub-millisecond precision is rejected. */
export const expiryAfter = Effect.fnUntraced(function* (
  duration: Duration.Duration,
): Effect.fn.Return<SetExpiry, CommandInputError> {
  if (duration.value._tag === "Nanos" && duration.value.nanos % 1000000n !== 0n)
    return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
  const value = yield* Schema.decodeUnknownEffect(PositiveInteger)(
    duration.value._tag === "Nanos"
      ? Number(duration.value.nanos / 1000000n)
      : Duration.toMillis(duration),
  ).pipe(Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "options" })));
  return { type: "PX", value };
});
