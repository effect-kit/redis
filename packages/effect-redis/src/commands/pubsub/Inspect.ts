import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { defineCommand, fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { pairs, simpleText, unsigned, withLength } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
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

const subscriberCounts = (name: "NUMSUB" | "SHARDNUMSUB", channels: ReadonlyArray<RedisArgument>) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(Schema.Array(Argument), channels);

      return yield* defineCommand({
        metadata: metadata(`PUBSUB ${name}`, "pubsub", ["PUSH"]),
        tokens: ["PUBSUB", name, ...selected],
        routing: { _tag: "Keyless" },
        decode: withLength(selected.length, pairs(blob, unsigned)),
      }).prepare;
    }),
  );

export const pubsubNumSub = (channels: ReadonlyArray<RedisArgument> = []) =>
  subscriberCounts("NUMSUB", channels);

export const pubsubShardNumSub = (channels: ReadonlyArray<RedisArgument> = []) =>
  subscriberCounts("SHARDNUMSUB", channels);

export const pubsubNumPat = () => inspect("NUMPAT", [], unsigned);

export const pubsubHelp = () => inspect("HELP", [], array(simpleText));
