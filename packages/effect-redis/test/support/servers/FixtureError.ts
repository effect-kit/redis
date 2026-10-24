import { Schema } from "effect";

export class FixtureError extends Schema.TaggedError<FixtureError>()("FixtureError", {
  stage: Schema.String,
  diagnostic: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown)),
}) {}
