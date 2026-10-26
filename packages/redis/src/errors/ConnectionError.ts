import { Schema } from "effect";

export class ConnectionError extends Schema.TaggedError<ConnectionError>()("ConnectionError", {
  reason: Schema.Literals([
    "closed",
    "transport",
    "protocol",
    "timeout",
    "aborted",
    "push-overflow",
    "unavailable",
    "shutdown-timeout",
  ]),
  delivery: Schema.Literals(["unsent", "possibly-written"]),
  generation: Schema.Number,
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
