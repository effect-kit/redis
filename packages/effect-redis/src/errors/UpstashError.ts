import { Schema } from "effect";

/** HTTP errors expose delivery evidence, never request URLs, bodies, or bearer tokens. */
export class UpstashError extends Schema.TaggedError<UpstashError>()("UpstashError", {
  stage: Schema.Literals(["config", "request", "response", "stream"]),
  reason: Schema.Literals([
    "configuration",
    "authentication",
    "status",
    "rate-limit",
    "network",
    "timeout",
    "limit",
    "encoding",
    "malformed",
    "unsupported",
    "capacity",
    "closed",
    "gap",
  ]),
  delivery: Schema.Literals(["unsent", "unknown", "replied"]),
  status: Schema.optionalKey(Schema.Int),
}) {}
