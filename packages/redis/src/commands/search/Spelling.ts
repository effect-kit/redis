import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { pairs, simpleText, tuple } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Argument, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { moduleDouble } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchSpelling {
  readonly term: Uint8Array;
  readonly suggestions: ReadonlyArray<{ readonly term: Uint8Array; readonly score: number }>;
}
const nativeSuggestions = (reply: Parameters<ReplyDecoder<unknown>>[0]) =>
  array(pairs(blob, moduleDouble))(reply).pipe(
    Effect.map((groups) =>
      groups.flatMap((entries) => entries.map(([term, score]) => ({ term, score }))),
    ),
  );
const legacyTerm: ReplyDecoder<SearchSpelling> = (reply) =>
  Effect.gen(function* () {
    const value = undecorate(reply);
    if (value._tag !== "Array" || value.values.length !== 3) return yield* mismatch("array", reply);
    const [kind, term, suggestions] = value.values;
    if (
      kind === undefined ||
      term === undefined ||
      suggestions === undefined ||
      (yield* simpleText(kind)) !== "TERM"
    )
      return yield* mismatch("custom", reply);
    return {
      term: yield* blob(term),
      suggestions: (yield* array(tuple(moduleDouble, blob))(suggestions)).map(
        ([score, suggestedTerm]) => ({
          term: suggestedTerm,
          score,
        }),
      ),
    };
  });
const spelling: ReplyDecoder<ReadonlyArray<SearchSpelling>> = (reply) =>
  Effect.gen(function* () {
    if (undecorate(reply)._tag !== "Map") return yield* array(legacyTerm)(reply);
    const report = yield* fields(reply);
    const results = report.find(([key]) => key === "results")?.[1];
    if (results === undefined) return yield* mismatch("custom", reply);
    return (yield* pairs(blob, nativeSuggestions)(results)).map(([term, suggestions]) => ({
      term,
      suggestions,
    }));
  });
export interface SearchSpellcheckOptions {
  readonly distance?: Integer;
  readonly terms?: ReadonlyArray<{
    readonly mode: "INCLUDE" | "EXCLUDE";
    readonly dictionary: RedisArgument;
    readonly terms?: ReadonlyArray<RedisArgument>;
  }>;
  readonly dialect?: Integer;
}
export const ftSpellcheck = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchSpellcheckOptions = {},
) =>
  moduleKeyless(
    "search",
    "FT.SPELLCHECK",
    spelling,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          distance: Schema.optionalKey(Positive.check(Schema.makeFilter((n) => n <= 4))),
          terms: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                mode: Schema.Literals(["INCLUDE", "EXCLUDE"]),
                dictionary: Argument,
                terms: Schema.optionalKey(Schema.Array(Argument)),
              }),
            ),
          ),
          dialect: Schema.optionalKey(Positive),
        }),
        options,
      );
      return [
        index,
        query,
        ...(selected.distance === undefined ? [] : ["DISTANCE", String(selected.distance)]),
        ...(selected.terms ?? []).flatMap((entry) =>
          ["TERMS", entry.mode, entry.dictionary].concat(entry.terms ?? []),
        ),
        ...(selected.dialect === undefined ? [] : ["DIALECT", String(selected.dialect)]),
      ];
    }),
  );
