import { Schema } from "effect";

export class CommandInputError extends Schema.TaggedError<CommandInputError>()(
  "CommandInputError",
  {
    delivery: Schema.Literal("unsent"),
    reason: Schema.Literals(["arguments", "options", "metadata", "routing"]),
  },
) {}
