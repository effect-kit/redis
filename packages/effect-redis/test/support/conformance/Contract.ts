import { Schema } from "effect";

export const Engine = Schema.Literals([
  "redis",
  "valkey",
  "dragonfly",
  "keydb",
  "redict",
  "garnet",
  "kvrocks",
]);
export type Engine = typeof Engine.Type;

export const Domain = Schema.Literals([
  "strings",
  "collections",
  "keys",
  "ordered",
  "sessions",
  "events",
  "modules",
  "extensions",
  "sparse",
  "administration",
  "uncertainty",
  "all",
  "garnet-lua",
]);
export type Domain = typeof Domain.Type;

export const Input = Schema.Struct({
  engine: Engine,
  version: Schema.NonEmptyString,
  protocol: Schema.Literals(["resp2", "resp3"]),
  domain: Domain,
  config: Schema.Unknown,
});
export type Input = typeof Input.Type;

export const Observation = Schema.Struct({
  id: Schema.NonEmptyString,
  command: Schema.NonEmptyString,
  outcome: Schema.Literals(["passed", "expected-unsupported", "different"]),
});
export type Observation = typeof Observation.Type;

export const Receipt = Schema.Struct({
  runtime: Schema.Literals(["node", "bun"]),
  runtimeVersion: Schema.NonEmptyString,
  runtimeRevision: Schema.optionalKey(Schema.String),
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  engine: Engine,
  version: Schema.NonEmptyString,
  protocol: Schema.Literals(["resp2", "resp3"]),
  domain: Domain,
  inventory: Schema.Struct({
    commands: Schema.NonEmptyArray(Schema.NonEmptyString),
    commandDigest: Schema.String,
    moduleInventory: Schema.Literals(["listed", "unavailable"]),
    modules: Schema.Array(Schema.Struct({ name: Schema.String, version: Schema.String })),
  }),
  profile: Schema.Struct({ id: Schema.NonEmptyString, revision: Schema.NonEmptyString }),
  observations: Schema.NonEmptyArray(Observation),
});
export type Receipt = typeof Receipt.Type;
