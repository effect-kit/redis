import { Schema } from "effect";

export class DiagnosticError extends Schema.TaggedError<DiagnosticError>()("DiagnosticError", {
  reason: Schema.Literals([
    "closed",
    "overflow",
    "concurrent-consumer",
    "invalid-frame",
    "capacity",
  ]),
  generation: Schema.Number,
}) {}
