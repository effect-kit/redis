import { Schema } from "effect";

/** Routing diagnostics never contain keys, server text or endpoint credentials. */
export class ClusterError extends Schema.TaggedError<ClusterError>()("ClusterError", {
  delivery: Schema.Literals(["unsent", "replied"]),
  reason: Schema.Literals([
    "cross-slot",
    "unresolved-keys",
    "explicit-target-required",
    "node-unavailable",
    "invalid-topology",
    "invalid-redirect",
    "redirect-limit",
    "capacity",
    "closed",
    "timeout",
    "database",
    "session-route",
    "topology-changed",
  ]),
  slot: Schema.optionalKey(Schema.Int),
}) {}
