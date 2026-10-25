import { Schema } from "effect";

export class SessionError extends Schema.TaggedError<SessionError>()("SessionError", {
  reason: Schema.Literals([
    "closed",
    "busy",
    "transaction-active",
    "invalid-state",
    "pool-full",
    "lease-timeout",
    "batch-limit",
    "execution-mode",
    "routing",
    "cleanup",
    "generation-lost",
  ]),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
  delivery: Schema.Literals(["unsent", "replied", "possibly-written"]),
}) {}
