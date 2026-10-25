import { Effect } from "effect";

import { fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import type { CommandMetadata } from "#/command/Metadata";
import { withLength } from "#/command/reply/Data";
import { keyed } from "#/commands/internal/Command";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

/** Bind positional reply cardinality to the same prepared arguments that reach the wire. */
export const keyedVector = <A>(
  info: CommandMetadata,
  key: RedisArgument,
  values: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError>,
  decode: ReplyDecoder<ReadonlyArray<A>>,
  options: {
    readonly prefix?: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError>;
    readonly countedFields?: boolean;
    readonly access?: "read" | "read-write";
  } = {},
) =>
  fromPreparation(
    Effect.gen(function* () {
      const elements = yield* values;
      const prefix = yield* options.prefix ?? Effect.succeed([]);
      const count = options.countedFields ? ["FIELDS", String(elements.length)] : [];

      return yield* keyed(
        info,
        key,
        Effect.succeed([...prefix, ...count, ...elements]),
        withLength(elements.length, decode),
        options.access ?? "read",
      ).prepare;
    }),
  );
