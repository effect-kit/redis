import { Schema } from "effect";

export const Provider = Schema.Literals([
  "upstash-native",
  "upstash-http",
  "aiven",
  "redis-cloud-free",
  "workers",
]);
export type Provider = typeof Provider.Type;

export const Runtime = Schema.Literals(["node", "bun", "deno", "workers"]);
export type Runtime = typeof Runtime.Type;

export const HttpScenario = Schema.Literals([
  "data",
  "collections",
  "batches",
  "events",
  "extensions",
]);
export type HttpScenario = typeof HttpScenario.Type;

export const Prefix = Schema.String.check(
  Schema.isPattern(/^effect-kit:providers:[a-f0-9-]{36}:[a-z0-9-]+:$/),
);

export const Observation = Schema.Struct({
  id: Schema.NonEmptyString,
  outcome: Schema.Literals(["passed", "unsupported", "limited"]),
  detail: Schema.optionalKey(Schema.NonEmptyString),
});
export type Observation = typeof Observation.Type;

export const Receipt = Schema.Struct({
  provider: Provider,
  runtime: Runtime,
  runtimeVersion: Schema.NonEmptyString,
  protocol: Schema.Literals(["resp2", "resp3", "http"]),
  scenario: Schema.NonEmptyString,
  profile: Schema.NonEmptyString,
  server: Schema.Struct({
    redisVersion: Schema.optionalKey(Schema.NonEmptyString),
    valkeyVersion: Schema.optionalKey(Schema.NonEmptyString),
    mode: Schema.optionalKey(Schema.NonEmptyString),
  }),
  observations: Schema.NonEmptyArray(Observation),
  cleanup: Schema.Literal(true),
});
export type Receipt = typeof Receipt.Type;

export const NativeInput = Schema.Struct({
  provider: Schema.Literals(["upstash-native", "aiven", "redis-cloud-free"]),
  protocol: Schema.Literals(["resp2", "resp3"]),
  url: Schema.NonEmptyString,
  ca: Schema.optionalKey(Schema.NonEmptyString),
  prefix: Prefix,
});
export type NativeInput = typeof NativeInput.Type;

export const HttpInput = Schema.Struct({
  url: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  prefix: Prefix,
  scenario: HttpScenario,
});
export type HttpInput = typeof HttpInput.Type;
