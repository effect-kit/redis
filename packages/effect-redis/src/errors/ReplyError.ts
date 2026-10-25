import { Schema } from "effect";

export class ReplyError extends Schema.TaggedError<ReplyError>()("ReplyError", {
  delivery: Schema.Literal("replied"),
  expected: Schema.Literals([
    "blob",
    "text",
    "integer",
    "safe-integer",
    "score",
    "status",
    "array",
    "array-length",
    "set-result",
    "custom",
  ]),
  actual: Schema.String,
  path: Schema.Array(Schema.Int),
}) {}
