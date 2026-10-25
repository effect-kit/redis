import { Effect, Schema } from "effect";

import { parse, NonNegative } from "#/commands/internal/Input";
import { StreamPosition } from "#/commands/streams/Id";
import type { RedisArgument } from "#/RedisArgument";

export const ReferencePolicy = Schema.Literals(["KEEPREF", "DELREF", "ACKED"]);
export type ReferencePolicy = typeof ReferencePolicy.Type;

export const Trim = Schema.Union([
  Schema.Struct({
    by: Schema.Literal("MAXLEN"),
    threshold: NonNegative,
    approximate: Schema.optionalKey(Schema.Boolean),
    limit: Schema.optionalKey(NonNegative),
  }),
  Schema.Struct({
    by: Schema.Literal("MINID"),
    threshold: StreamPosition,
    approximate: Schema.optionalKey(Schema.Boolean),
    limit: Schema.optionalKey(NonNegative),
  }),
]);
export type StreamTrim = typeof Trim.Type;

export const trimTokens = Effect.fnUntraced(function* (trim: StreamTrim) {
  const selected = yield* parse(Trim, trim);
  // Redis permits LIMIT only with approximate trimming; zero explicitly means unlimited work.
  if (selected.limit !== undefined && selected.approximate !== true)
    return yield* parse(Schema.Never, selected.limit);
  return [
    selected.by,
    selected.approximate ? "~" : "=",
    String(selected.threshold),
    ...(selected.limit === undefined ? [] : ["LIMIT", String(selected.limit)]),
  ] satisfies ReadonlyArray<RedisArgument>;
});
