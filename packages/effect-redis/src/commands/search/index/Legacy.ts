import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { simpleText } from "#/command/reply/Data";
import { mismatch, status } from "#/command/reply/Scalars";
import { Pairs, Argument, Finite, parse } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { moduleBoolean } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchLegacyAddOptions {
  readonly replace?: boolean;
  readonly partial?: boolean;
  readonly noCreate?: boolean;
  readonly condition?: string;
  readonly language?: RedisArgument;
  readonly payload?: RedisArgument;
}
const added: ReplyDecoder<boolean> = (reply) =>
  simpleText(reply).pipe(
    Effect.flatMap((value) =>
      value === "OK"
        ? Effect.succeed(true)
        : value === "NOADD"
          ? Effect.succeed(false)
          : Effect.fail(mismatch("status", reply)),
    ),
  );
const add = (
  name: string,
  index: RedisArgument,
  key: RedisArgument,
  score: number,
  fields: readonly [
    readonly [RedisArgument, RedisArgument],
    ...Array<readonly [RedisArgument, RedisArgument]>,
  ],
  options: SearchLegacyAddOptions,
) =>
  moduleKeyless(
    "search",
    name,
    added,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({
          replace: Schema.optionalKey(Schema.Boolean),
          partial: Schema.optionalKey(Schema.Boolean),
          noCreate: Schema.optionalKey(Schema.Boolean),
          condition: Schema.optionalKey(Schema.String),
          language: Schema.optionalKey(Argument),
          payload: Schema.optionalKey(Argument),
        }),
        options,
      );
      const weight = yield* parse(
        Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        score,
      );
      const entries = yield* parse(Pairs, fields);

      return [
        index,
        key,
        String(weight),
        ...(selected.replace ? ["REPLACE"] : []),
        ...(selected.partial ? ["PARTIAL"] : []),
        ...(selected.noCreate ? ["NOCREATE"] : []),
        ...(selected.condition === undefined ? [] : ["IF", selected.condition]),
        ...(selected.language === undefined ? [] : ["LANGUAGE", selected.language]),
        ...(selected.payload === undefined ? [] : ["PAYLOAD", selected.payload]),
        "FIELDS",
        ...entries.flatMap(([field, value]) => [field, value]),
      ];
    }),
  );
/** Retained legacy HASH indexing. Modern applications normally write HASH/JSON keys directly. */
export const ftAdd = (
  index: RedisArgument,
  key: RedisArgument,
  score: number,
  fields: readonly [
    readonly [RedisArgument, RedisArgument],
    ...Array<readonly [RedisArgument, RedisArgument]>,
  ],
  options: SearchLegacyAddOptions = {},
) => add("FT.ADD", index, key, score, fields, options);
export const ftSafeadd = (
  index: RedisArgument,
  key: RedisArgument,
  score: number,
  fields: readonly [
    readonly [RedisArgument, RedisArgument],
    ...Array<readonly [RedisArgument, RedisArgument]>,
  ],
  options: SearchLegacyAddOptions = {},
) => add("FT.SAFEADD", index, key, score, fields, options);
export const ftDel = (index: RedisArgument, key: RedisArgument) =>
  moduleKeyless("search", "FT.DEL", moduleBoolean, Effect.succeed([index, key]));
export const ftDrop = (index: RedisArgument, options: { readonly keepDocuments?: boolean } = {}) =>
  moduleKeyless(
    "search",
    "FT.DROP",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ keepDocuments: Schema.optionalKey(Schema.Boolean) }),
        options,
      );
      return [index, ...(selected.keepDocuments ? ["KEEPDOCS"] : [])];
    }),
  );
