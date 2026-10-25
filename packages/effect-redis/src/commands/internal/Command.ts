import { Effect } from "effect";

import { defineCommand, fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import type { CommandMetadata, Routing } from "#/command/Metadata";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisArgument } from "#/RedisArgument";

export interface Intent {
  readonly tokens: RedisCommand;
  readonly routing: Routing;
}

export const ordinary = <A>(
  info: CommandMetadata,
  decode: ReplyDecoder<A>,
  prepare: Effect.Effect<Intent, CommandInputError>,
) =>
  fromPreparation(
    prepare.pipe(
      Effect.flatMap((intent) => defineCommand({ metadata: info, decode, ...intent }).prepare),
    ),
  );

export const keyIndexes = (
  indexes: ReadonlyArray<number>,
  access: "read" | "write" | "read-write",
): Routing => {
  const [first, ...rest] = indexes;
  return first === undefined
    ? { _tag: "Keyless" }
    : {
        _tag: "Keys",
        keys: [{ index: first, access }, ...rest.map((index) => ({ index, access }))],
      };
};

export const keyed = <A>(
  info: CommandMetadata,
  key: RedisArgument,
  tail: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError>,
  decode: ReplyDecoder<A>,
  access: "read" | "write" | "read-write" = "read",
) =>
  ordinary(
    info,
    decode,
    tail.pipe(
      Effect.map((args): Intent => {
        const [name = "", ...subcommands] = info.name.split(" ");
        return {
          tokens: [name, ...subcommands, key, ...args],
          routing: keyIndexes([1 + subcommands.length], access),
        };
      }),
    ),
  );
