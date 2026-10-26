import { Schema } from "effect";

import { Argument } from "#/commands/internal/Input";
import { ReferencePolicy, Trim } from "#/commands/streams/Trim";

export const AddOptions = Schema.Struct({
  trim: Schema.optionalKey(Trim),
  references: Schema.optionalKey(ReferencePolicy),
  idempotency: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ mode: Schema.Literal("IDMPAUTO"), producer: Argument }),
      Schema.Struct({ mode: Schema.Literal("IDMP"), producer: Argument, id: Argument }),
    ]),
  ),
});
export type StreamAddOptions = typeof AddOptions.Type;
