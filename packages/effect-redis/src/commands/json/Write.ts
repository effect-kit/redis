import { Effect, Option, Schema } from "effect";

import type { PayloadCodec } from "#/codecs/PayloadCodec";
import type { ReplyDecoder } from "#/command/Command";
import { nullable, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import type { RedisArgument } from "#/RedisArgument";

export interface JsonSetOptions {
  readonly condition?: "NX" | "XX";
  readonly floatingPoint?: "BF16" | "FP16" | "FP32" | "FP64";
  readonly format?: "STRING" | "JSON" | "BSON";
}
const SetOptions = Schema.Struct({
  condition: Schema.optionalKey(Schema.Literals(["NX", "XX"])),
  floatingPoint: Schema.optionalKey(Schema.Literals(["BF16", "FP16", "FP32", "FP64"])),
  format: Schema.optionalKey(Schema.Literals(["STRING", "JSON", "BSON"])),
});
const applied: ReplyDecoder<boolean> = (reply) =>
  nullable(status("OK"))(reply).pipe(Effect.map(Option.isSome));

/** The document is already encoded. Schema encoding is explicitly selected by jsonSetWith. */
export const jsonSet = (
  key: RedisArgument,
  path: string,
  document: RedisArgument,
  options: JsonSetOptions = {},
) =>
  moduleKeyed(
    "json",
    "JSON.SET",
    key,
    applied,
    Effect.gen(function* () {
      const selected = yield* parse(SetOptions, options);
      const selectedPath = yield* parse(Schema.NonEmptyString, path);
      return [
        selectedPath,
        document,
        ...(selected.condition === undefined ? [] : [selected.condition]),
        ...(selected.floatingPoint === undefined ? [] : ["FPHA", selected.floatingPoint]),
        ...(selected.format === undefined ? [] : ["FORMAT", selected.format]),
      ];
    }),
    "read-write",
  );

export const jsonSetWith = <A, RD, RE>(
  key: RedisArgument,
  path: string,
  value: A,
  codec: PayloadCodec<A, RD, RE>,
  options: Omit<JsonSetOptions, "format"> = {},
) => ({
  prepare: Effect.gen(function* () {
    // Validate and snapshot options before an application encoder can suspend.
    const selected = yield* parse(
      Schema.Struct({
        condition: SetOptions.fields.condition,
        floatingPoint: SetOptions.fields.floatingPoint,
      }),
      options,
    );
    const selectedPath = yield* parse(Schema.NonEmptyString, path);
    const bytes = yield* codec.encode(value);
    return yield* jsonSet(key, selectedPath, bytes, selected).prepare;
  }),
});

export const jsonMerge = (
  key: RedisArgument,
  path: string,
  document: RedisArgument,
  options: { readonly format?: "STRING" | "JSON" | "BSON" } = {},
) =>
  moduleKeyed(
    "json",
    "JSON.MERGE",
    key,
    applied,
    Effect.gen(function* () {
      const selectedPath = yield* parse(Schema.NonEmptyString, path);
      const selected = yield* parse(Schema.Struct({ format: SetOptions.fields.format }), options);
      return [
        selectedPath,
        document,
        ...(selected.format === undefined ? [] : ["FORMAT", selected.format]),
      ];
    }),
    "read-write",
  );

export const jsonMset = (
  entries: readonly [
    readonly [RedisArgument, string, RedisArgument],
    ...Array<readonly [RedisArgument, string, RedisArgument]>,
  ],
) =>
  ordinary(
    moduleMetadata("json", "JSON.MSET"),
    status("OK"),
    parse(
      Schema.NonEmptyArray(Schema.Tuple([Argument, Schema.NonEmptyString, Argument])),
      entries,
    ).pipe(
      Effect.map((selected) => ({
        tokens: [
          "JSON.MSET",
          ...selected.flatMap(([key, path, document]) => [key, path, document]),
        ],
        routing: keyIndexes(
          selected.map((_, index) => 1 + index * 3),
          "read-write",
        ),
      })),
    ),
  );

const remove = (name: string, key: RedisArgument, path: string) =>
  moduleKeyed(
    "json",
    name,
    key,
    unsigned,
    parse(Schema.NonEmptyString, path).pipe(Effect.map((selected) => [selected])),
    "read-write",
  );
export const jsonDel = (key: RedisArgument, path = "$") => remove("JSON.DEL", key, path);
export const jsonForget = (key: RedisArgument, path = "$") => remove("JSON.FORGET", key, path);
export const jsonClear = (key: RedisArgument, path = "$") => remove("JSON.CLEAR", key, path);
