import { Effect, Redacted, Schema } from "effect";

import { UpstashError } from "#/errors/UpstashError";

const positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 }));
const defaulted = (value: number) =>
  positive.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const Input = Schema.Struct({
  url: Schema.NonEmptyString,
  token: Schema.Redacted(Schema.NonEmptyString),
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

export type UpstashConfigInput = typeof Input.Encoded;
export type UpstashConfig = typeof Input.Type;

const invalid = () =>
  new UpstashError({ stage: "config", reason: "configuration", delivery: "unsent" });

export const decodeUpstashConfig = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* Schema.decodeUnknownEffect(Input, { onExcessProperty: "error" })(
    input,
  ).pipe(Effect.mapError(invalid));
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
    Redacted.value(config.token).length > 16384 ||
    /[\r\n]/.test(Redacted.value(config.token)) ||
    config.maxNestingDepth > 128 ||
    config.maxConcurrentRequests > 1024 ||
    config.maxBatchCommands > 10_000
  )
    return yield* invalid();

  return { ...config, url: url.origin };
});
