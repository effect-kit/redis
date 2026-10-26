import { Effect, Predicate, Result, Schema } from "effect";

import { parse } from "#/commands/internal/Input";
import { CommandInputError } from "#/errors/CommandInputError";
import { parseJson } from "#/upstash/encoding/Json";

export type JsonObjectArgument = Schema.JsonObject | string;

const bounded = (input: unknown) => {
  const pending: Array<readonly [unknown, number]> = [[input, 0]];
  let count = 0;
  let characters = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) return false;
    const [value, depth] = next;
    if (++count > 100_000 || depth > 64) return false;
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
    )
      return false;
    if (typeof value === "string") characters += value.length;
    if (Array.isArray(value)) {
      if (value.length > 100_000 - count) return false;
      for (const child of value) pending.push([child, depth + 1]);
    } else if (Predicate.isObject(value)) {
      const keys = Object.keys(value);
      if (keys.length > 100_000 - count) return false;
      for (const key of keys) {
        characters += key.length;
        pending.push([value[key], depth + 1]);
      }
    }
    if (characters > 1024 * 1024) return false;
  }
  return true;
};

/** A serialized object allows explicit int64 JSON lexemes without rounding through JS numbers. */
export const jsonArgument = Effect.fnUntraced(function* (input: JsonObjectArgument) {
  if (typeof input === "string") {
    const selected = yield* parse(Schema.String.check(Schema.isMaxLength(1024 * 1024)), input);
    const decoded = parseJson(selected, { maxNestingDepth: 64, maxAggregateEntries: 100_000 });
    if (Result.isFailure(decoded) || !(decoded.success instanceof Map))
      return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });
    return selected;
  }

  yield* parse(Schema.Unknown.check(Schema.makeFilter(bounded)), input);
  return JSON.stringify(yield* parse(Schema.JsonObject, input));
});
