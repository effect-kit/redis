import { Schema } from "effect";

export class ProfileError extends Schema.TaggedError<ProfileError>()("ProfileError", {
  delivery: Schema.Literal("unsent"),
  reason: Schema.Literals([
    "configuration",
    "routing",
    "tls",
    "identity",
    "database",
    "restricted-command",
    "module",
    "network-policy",
  ]),
}) {}
