import { Schema } from "effect";

export class UnsupportedCommandError extends Schema.TaggedError<UnsupportedCommandError>()(
  "UnsupportedCommandError",
  {
    delivery: Schema.Literal("unsent"),
    reason: Schema.Literals(["execution-mode", "explicit-node"]),
  },
) {}
