import { Effect, Schema } from "effect";

import { CredentialError } from "#/errors/CredentialError";

const Millis = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 * 24 * 60 * 60 * 1000 }));

export const CredentialLifetime = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("reconnect") }),
  Schema.Struct({
    mode: Schema.Literal("token-expiry"),
    retireBeforeMillis: Millis.pipe(Schema.withDecodingDefaultKey(Effect.succeed(30_000))),
  }),
  Schema.Struct({
    mode: Schema.Literal("max-age"),
    maxAgeMillis: Millis.check(Schema.isGreaterThan(0)),
  }),
]);
export type CredentialLifetime = typeof CredentialLifetime.Encoded;

export const decodeCredentialLifetime = (input: unknown) =>
  Schema.decodeUnknownEffect(CredentialLifetime, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(() => new CredentialError({ reason: "configuration" })),
  );
