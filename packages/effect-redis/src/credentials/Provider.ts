import { Effect, Predicate, Schema } from "effect";

import { CredentialError } from "#/errors/CredentialError";

const Millis = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));

export const CredentialValues = Schema.Struct({
  username: Schema.optionalKey(Schema.Redacted(Schema.String)),
  password: Schema.Redacted(Schema.String),
  /** Absolute UTC epoch milliseconds for accepting a new authentication, not a socket deadline. */
  expiresAtMillis: Schema.optionalKey(Millis),
});
export type CredentialValues = typeof CredentialValues.Type;

export const RefreshPolicy = Schema.Struct({
  refreshBeforeMillis: Millis.pipe(Schema.withDecodingDefaultKey(Effect.succeed(60_000))),
  acquisitionTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 60_000 }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(5000))),
  maxWaiters: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(128)),
  ),
});
export type RefreshPolicy = typeof RefreshPolicy.Type;

export interface CredentialProvider<R = never> {
  readonly _tag: "CredentialProvider";
  readonly acquire: Effect.Effect<CredentialValues | undefined, unknown, R>;
  readonly policy: Partial<RefreshPolicy>;
}

export type CredentialInput<R = never> =
  | CredentialValues
  | Effect.Effect<CredentialValues | undefined, unknown, R>
  | CredentialProvider<R>;

const isProvider = <R>(input: CredentialInput<R>): input is CredentialProvider<R> =>
  Predicate.hasProperty(input, "_tag") && input._tag === "CredentialProvider";

export const decodeCredentialInput = Effect.fnUntraced(function* <R>(
  input: CredentialInput<R> | undefined,
) {
  if (input === undefined) return { source: undefined, fixed: undefined };
  if (Effect.isEffect(input)) return { source: provider(input), fixed: undefined };
  if (isProvider(input)) {
    if (!Effect.isEffect(input.acquire))
      return yield* new CredentialError({ reason: "configuration" });
    return { source: input, fixed: undefined };
  }
  const fixed = yield* Schema.decodeUnknownEffect(CredentialValues, { onExcessProperty: "error" })(
    input,
  ).pipe(Effect.mapError(() => new CredentialError({ reason: "configuration" })));
  return { source: undefined, fixed };
});

/** Pure declaration. Each consuming client Layer creates its own scoped refresh coordinator. */
export const provider = <E, R>(
  acquire: Effect.Effect<CredentialValues | undefined, E, R>,
  policy: Partial<RefreshPolicy> = {},
): CredentialProvider<R> => ({ _tag: "CredentialProvider", acquire, policy });

export const decodeRefreshPolicy = (input: unknown) =>
  Schema.decodeUnknownEffect(RefreshPolicy, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(() => new CredentialError({ reason: "configuration" })),
  );
