import { Schema } from "effect";

/** Safe diagnostics never retain the rejected input or Schema issue tree. */
export class RedisConfigError extends Schema.TaggedError<RedisConfigError>()("RedisConfigError", {
  field: Schema.String,
  reason: Schema.String,
}) {}
