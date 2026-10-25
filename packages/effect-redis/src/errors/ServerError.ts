import { Schema } from "effect";

export class ServerError extends Schema.TaggedError<ServerError>()("ServerError", {
  delivery: Schema.Literal("replied"),
  code: Schema.String,
  reply: Schema.Redacted(Schema.Unknown),
}) {}
