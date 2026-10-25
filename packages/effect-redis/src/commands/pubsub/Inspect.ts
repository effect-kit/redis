import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { pairs, unsigned } from "#/command/reply/Data";
import { blob, text } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

const inspect = <A>(
  name: string,
  arguments_: ReadonlyArray<RedisArgument>,
  decode: ReplyDecoder<A>,
) =>
  ordinary(
    metadata(`PUBSUB ${name}`, "pubsub", ["PUSH"]),
    decode,
    parse(Schema.Array(Argument), arguments_).pipe(
      Effect.map((tokens) => ({
        tokens: ["PUBSUB", name, ...tokens] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

export const pubsubChannels = (pattern?: RedisArgument) =>
  inspect("CHANNELS", pattern === undefined ? [] : [pattern], array(blob));

export const pubsubShardChannels = (pattern?: RedisArgument) =>
  inspect("SHARDCHANNELS", pattern === undefined ? [] : [pattern], array(blob));

export const pubsubNumSub = (channels: ReadonlyArray<RedisArgument> = []) =>
  inspect("NUMSUB", channels, pairs(blob, unsigned));

export const pubsubShardNumSub = (channels: ReadonlyArray<RedisArgument> = []) =>
  inspect("SHARDNUMSUB", channels, pairs(blob, unsigned));

export const pubsubNumPat = () => inspect("NUMPAT", [], unsigned);

export const pubsubHelp = () => inspect("HELP", [], array(text));
