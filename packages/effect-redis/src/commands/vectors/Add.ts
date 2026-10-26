import { Effect, Schema } from "effect";

import { Argument, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { moduleBoolean } from "#/commands/modules/Reply";
import { vectorTokens } from "#/commands/vectors/Input";
import type { VectorInput } from "#/commands/vectors/Input";
import type { RedisArgument } from "#/RedisArgument";

export interface VectorAddOptions {
  readonly reduce?: Integer;
  readonly cas?: boolean;
  readonly quantization?: "NOQUANT" | "BIN" | "Q8";
  readonly ef?: Integer;
  readonly attributes?: RedisArgument;
  readonly connections?: Integer;
}
const Options = Schema.Struct({
  reduce: Schema.optionalKey(Positive),
  cas: Schema.optionalKey(Schema.Boolean),
  quantization: Schema.optionalKey(Schema.Literals(["NOQUANT", "BIN", "Q8"])),
  ef: Schema.optionalKey(Positive.check(Schema.makeFilter((n) => n <= 1_000_000))),
  attributes: Schema.optionalKey(Argument),
  connections: Schema.optionalKey(Positive),
});

/** Repeat nondefault quantization/M on later inserts. CAS is a server insertion algorithm, not a transaction guarantee. */
export const vadd = (
  key: RedisArgument,
  vector: VectorInput,
  element: RedisArgument,
  options: VectorAddOptions = {},
) =>
  moduleKeyed(
    "vectorset",
    "VADD",
    key,
    moduleBoolean,
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      const encoded = yield* vectorTokens(vector);

      return [
        ...(selected.reduce === undefined ? [] : ["REDUCE", String(selected.reduce)]),
        ...encoded,
        element,
        ...(selected.cas ? ["CAS"] : []),
        ...(selected.quantization === undefined ? [] : [selected.quantization]),
        ...(selected.ef === undefined ? [] : ["EF", String(selected.ef)]),
        ...(selected.attributes === undefined ? [] : ["SETATTR", selected.attributes]),
        ...(selected.connections === undefined ? [] : ["M", String(selected.connections)]),
      ];
    }),
    "read-write",
  );
