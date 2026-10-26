import { Schema } from "effect";

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  stage: Schema.Literals(["open", "read", "write", "close"]),
  reason: Schema.Literals(["closed", "unavailable", "io", "limit", "timeout", "policy"]),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
