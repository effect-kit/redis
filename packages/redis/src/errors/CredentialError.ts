import { Schema } from "effect";

/** Identity failures carry no provider response, token or credential-bearing URL in diagnostics. */
export class CredentialError extends Schema.TaggedError<CredentialError>()("CredentialError", {
  reason: Schema.Literals([
    "configuration",
    "acquisition",
    "expired",
    "timeout",
    "capacity",
    "closed",
    "rotated",
    "retirement",
  ]),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
