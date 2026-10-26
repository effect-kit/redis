import { Effect, Schema } from "effect";

import { UpstashError } from "#/errors/UpstashError";

const positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 }));
const defaulted = (value: number) =>
  positive.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const Settings = Schema.Struct({
  url: Schema.NonEmptyString,
  allowInsecureLocalhost: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  requestTimeoutMillis: defaulted(30_000),
  streamHandshakeTimeoutMillis: defaulted(10_000),
  streamIdleTimeoutMillis: Schema.optionalKey(positive),
  maxConcurrentRequests: defaulted(32),
  maxBatchCommands: defaulted(256),
  maxRequestBytes: defaulted(8 * 1024 * 1024),
  maxResponseBytes: defaulted(16 * 1024 * 1024),
  maxNestingDepth: defaulted(64),
  maxAggregateEntries: defaulted(100_000),
  maxEventBytes: defaulted(1024 * 1024),
});

const Bearer = Schema.Redacted(
  Schema.NonEmptyString.check(Schema.isPattern(/^[!-~]+$/), Schema.isMaxLength(16384)),
);
const Input = Schema.Struct({ ...Settings.fields, token: Bearer });

export type UpstashConfigInput = typeof Input.Encoded;
export type UpstashConfig = typeof Input.Type;
export type UpstashSettings = typeof Settings.Type;
export type UpstashSettingsInput = typeof Settings.Encoded;

const invalid = () =>
  new UpstashError({ stage: "config", reason: "configuration", delivery: "unsent" });

const normalize = Effect.fnUntraced(function* <A extends UpstashSettings>(config: A) {
  const url = yield* Effect.try({ try: () => new URL(config.url), catch: invalid });
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  if (
    (url.protocol !== "https:" &&
      !(config.allowInsecureLocalhost && local && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/" ||
    config.maxNestingDepth > 128 ||
    config.maxConcurrentRequests > 1024 ||
    config.maxBatchCommands > 10_000
  )
    return yield* invalid();

  return { ...config, url: url.origin };
});

export const decodeBearer = (input: unknown) =>
  Schema.decodeUnknownEffect(Bearer)(input).pipe(Effect.mapError(invalid));

export const decodeUpstashConfig = (input: unknown) =>
  Schema.decodeUnknownEffect(Input, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(invalid),
    Effect.flatMap(normalize),
  );

export const decodeUpstashSettings = (input: unknown) =>
  Schema.decodeUnknownEffect(Settings, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(invalid),
    Effect.flatMap(normalize),
  );
