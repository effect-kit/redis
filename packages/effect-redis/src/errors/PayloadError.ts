import { Schema } from "effect";

export class PayloadError extends Schema.TaggedError<PayloadError>()("PayloadError", {
  stage: Schema.Literals(["encode", "decode"]),
  cause: Schema.Redacted(Schema.Unknown),
}) {}
