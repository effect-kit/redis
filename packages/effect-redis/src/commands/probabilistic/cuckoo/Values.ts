import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { simpleText, unsigned, withLength } from "#/command/reply/Data";
import { fields } from "#/commands/admin/Build";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { cuckooInsertReply, moduleBoolean as boolean } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const cfAdd = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.ADD", key, boolean, Effect.succeed([value]), "read-write");
export const cfAddnx = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.ADDNX", key, boolean, Effect.succeed([value]), "read-write");
export const cfExists = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.EXISTS", key, boolean, Effect.succeed([value]));
export const cfCount = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.COUNT", key, unsigned, Effect.succeed([value]));
export const cfDel = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.DEL", key, boolean, Effect.succeed([value]), "read-write");
export const cfInfo = (key: RedisArgument) => moduleKeyed("probabilistic", "CF.INFO", key, fields);

export const cfDebug = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "CF.DEBUG", key, simpleText);
export const cfMexists = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  keyedVector(
    moduleMetadata("probabilistic", "CF.MEXISTS"),
    key,
    parse(Arguments, values),
    array(boolean),
  );

export interface CuckooInsertOptions {
  readonly capacity?: Integer;
  readonly noCreate?: boolean;
}
const Options = Schema.Struct({
  capacity: Schema.optionalKey(Positive),
  noCreate: Schema.optionalKey(Schema.Boolean),
});
const insert = (
  name: "CF.INSERT" | "CF.INSERTNX",
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
  options: CuckooInsertOptions,
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Options, options);
    const entries = yield* parse(Arguments, values);
    return yield* moduleKeyed(
      "probabilistic",
      name,
      key,
      withLength(entries.length, cuckooInsertReply),
      Effect.succeed([
        ...(selected.capacity === undefined ? [] : ["CAPACITY", String(selected.capacity)]),
        ...(selected.noCreate ? ["NOCREATE"] : []),
        "ITEMS",
        ...entries,
      ]),
      "read-write",
    ).prepare;
  }),
});
export const cfInsert = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
  options: CuckooInsertOptions = {},
) => insert("CF.INSERT", key, values, options);
export const cfInsertnx = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
  options: CuckooInsertOptions = {},
) => insert("CF.INSERTNX", key, values, options);
