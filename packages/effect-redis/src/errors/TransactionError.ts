import { Schema } from "effect";

export class TransactionError extends Schema.TaggedError<TransactionError>()("TransactionError", {
  reason: Schema.Literals(["queue-rejected", "exec-rejected"]),
  execution: Schema.Literals(["not-executed", "unknown"]),
  errors: Schema.Redacted(Schema.Unknown),
}) {}
