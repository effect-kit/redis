import { Schema } from "effect";

export const RuntimeInput = Schema.Union([
  Schema.Struct({
    scenario: Schema.Literal("transport"),
    config: Schema.Unknown,
    operation: Schema.Literals([
      "echo",
      "read",
      "write",
      "cancel-read",
      "cancel-write",
      "open-error",
      "open-cancel",
      "churn",
    ]),
    size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
]);

export type RuntimeInput = typeof RuntimeInput.Type;
