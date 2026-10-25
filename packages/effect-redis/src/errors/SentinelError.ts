import { Schema } from "effect";

/** Discovery diagnostics distinguish control/data failures without exposing service names or secrets. */
export class SentinelError extends Schema.TaggedError<SentinelError>()("SentinelError", {
  delivery: Schema.Literals(["unsent", "replied"]),
  reason: Schema.Literals([
    "unreachable",
    "unknown-service",
    "invalid-reply",
    "role-mismatch",
    "authentication",
    "data-unavailable",
    "capacity",
    "timeout",
    "closed",
    "topology-changed",
    "routing",
  ]),
  plane: Schema.Literals(["sentinel", "data"]),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
