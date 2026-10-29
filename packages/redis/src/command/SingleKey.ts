import { Effect, Result, Schema } from "effect";

import type { Command, ReplyDecoder } from "#/command/Command";
import type { CommandMetadata } from "#/command/Metadata";
import { parseMetadataResult } from "#/command/MetadataCache";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

const argumentsSchema = Schema.NonEmptyArray(Schema.Union([Schema.String, Schema.Uint8Array]));
const parseArguments = Schema.decodeUnknownResult(argumentsSchema);

/** Private built-ins own their routing/defaults; only caller arguments need repeated boundary parsing. */
export const singleKeyCommand = <A, E = never, R = never>(
  metadata: CommandMetadata,
  key: RedisArgument,
  tail: ReadonlyArray<RedisArgument>,
  access: "read" | "write" | "read-write",
  decode: ReplyDecoder<A, E, R>,
): Command<A, E, R> => ({
  prepare: Effect.suspend(() => {
    const parsedMetadata = parseMetadataResult(metadata);
    if (Result.isFailure(parsedMetadata))
      return Effect.fail(new CommandInputError({ delivery: "unsent", reason: "metadata" }));

    const tokens = parseArguments([metadata.name, key, ...tail]);
    if (Result.isFailure(tokens))
      return Effect.fail(new CommandInputError({ delivery: "unsent", reason: "arguments" }));

    // Each preparation has independent public snapshots, even when its routing shape is constant.
    return Effect.succeed({
      metadata: parsedMetadata.success,
      tokens: tokens.success,
      routing: { _tag: "Keys" as const, keys: [{ index: 1, access }] as const },
      decode,
      serverErrors: "fail" as const,
    });
  }),
});
