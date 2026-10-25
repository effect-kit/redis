import { Schema } from "effect";

export class HandshakeError extends Schema.TaggedError<HandshakeError>()("HandshakeError", {
  delivery: Schema.Literal("unsent"),
  stage: Schema.Literals(["credentials", "auth", "hello", "name", "database", "timeout"]),
  reason: Schema.Literals(["rejected", "invalid-reply", "unavailable", "timeout"]),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
