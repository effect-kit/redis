import { Schema } from "effect";

/** Outcomes are redacted because completed replies can contain application payloads. */
export class BatchError extends Schema.TaggedError<BatchError>()("BatchError", {
  phase: Schema.Literals(["pipeline", "transaction-queue", "transaction-exec"]),
  execution: Schema.Literals(["partial-or-unknown", "not-executed", "unknown", "replied"]),
  outcomes: Schema.Redacted(Schema.Unknown),
}) {}
