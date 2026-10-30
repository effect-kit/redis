import { Schema } from "effect";

export const ModuleProfile = Schema.Literals(["redis-modules", "redis-stack", "valkey-modules"]);

const Address = Schema.Struct({
  host: Schema.NonEmptyString,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
});

export const RuntimeInput = Schema.Union([
  Schema.Struct({
    scenario: Schema.Literal("pipelined-transactions"),
    config: Schema.Unknown,
    engine: Schema.Literals(["redis", "valkey"]),
  }),
  Schema.Struct({
    scenario: Schema.Literal("uncertainty"),
    config: Schema.Unknown,
    operation: Schema.Literals(["mutation", "exec", "group"]),
    key: Schema.NonEmptyString,
  }),
  Schema.Struct({
    scenario: Schema.Literals(["cluster", "sentinel"]),
    config: Schema.Unknown,
    addresses: Schema.NonEmptyArray(Address),
    barrier: Schema.String,
    tls: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    scenario: Schema.Literal("modules"),
    config: Schema.Unknown,
    profile: ModuleProfile,
  }),
  Schema.Struct({
    scenario: Schema.Literals([
      "client",
      "sessions",
      "events",
      "application",
      "auth-error",
      "smoke",
      "small-buffer",
    ]),
    config: Schema.Unknown,
  }),
  Schema.Struct({
    scenario: Schema.Literal("transport"),
    config: Schema.Unknown,
    operation: Schema.Literals([
      "echo",
      "read",
      "write",
      "cancel-read",
      "cancel-write",
      "open-error",
      "open-cancel",
      "late-open",
      "churn",
    ]),
    size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
]);

export type RuntimeInput = typeof RuntimeInput.Type;
