import { Schema } from "effect";

export class AdmissionError extends Schema.TaggedError<AdmissionError>()("AdmissionError", {
  reason: Schema.Literals(["count", "bytes", "oversized", "session-required"]),
  delivery: Schema.Literal("unsent"),
}) {}
