import { Context, Effect, Layer } from "effect";

import { BatchExecutor } from "#/command/BatchExecutor";
import { CommandExecutor } from "#/command/Executor";
import type { RedisExecutor } from "#/command/Executor";
import { raw } from "#/command/Raw";
import type { RawContract } from "#/command/Raw";
import { arrayFamily } from "#/commands/arrays/Family";
import { bitmapFamily } from "#/commands/bitmaps/Family";
import { connectionFamily } from "#/commands/connection/Ping";
import { geoFamily } from "#/commands/geo/Family";
import { hashFamily } from "#/commands/hashes/Family";
import { hyperloglogFamily } from "#/commands/hyperloglog/Family";
import { jsonFamily } from "#/commands/json/Family";
import { keyCommandFamily } from "#/commands/keys/Family";
import { listFamily } from "#/commands/lists/Family";
import { probabilisticFamily } from "#/commands/probabilistic/Family";
import { pubsubFamily } from "#/commands/pubsub/Family";
import { scanFamily } from "#/commands/scan/Family";
import { scriptingFamily } from "#/commands/scripting/Family";
import { searchFamily } from "#/commands/search/Family";
import { setFamily } from "#/commands/sets/Family";
import { sortedSetFamily } from "#/commands/sorted-sets/Family";
import { streamFamily } from "#/commands/streams/Family";
import { stringFamily } from "#/commands/strings/Family";
import { timeSeriesFamily } from "#/commands/timeseries/Family";
import { upstashFamily } from "#/commands/upstash/Family";
import { vectorFamily } from "#/commands/vectors/Family";
import { keyFamily } from "#/keys/Commands";
import type { RedisCommand } from "#/protocol/encode";
import type { AnyCommand } from "#/sessions/batch/Types";
import { observe, observedExecutor } from "#/telemetry/Observe";

export const makeRedis = (source: RedisExecutor) => {
  const executor = observedExecutor(source);

  return {
    upstash: upstashFamily(executor),
    ...connectionFamily(executor),
    ...scriptingFamily(executor),
    ...pubsubFamily(executor),
    ...probabilisticFamily(executor),
    ...jsonFamily(executor),
    ...vectorFamily(executor),
    ...timeSeriesFamily(executor),
    ...searchFamily(executor),
    ...scanFamily(executor),
    ...streamFamily(executor),
    ...stringFamily(executor),
    ...sortedSetFamily(executor),
    ...hashFamily(executor),
    ...listFamily(executor),
    ...setFamily(executor),
    ...hyperloglogFamily(executor),
    ...bitmapFamily(executor),
    ...keyCommandFamily(executor),
    ...arrayFamily(executor),
    ...geoFamily(executor),
    ...keyFamily(executor),

    pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      observe(
        "pipeline",
        BatchExecutor.pipe(Effect.flatMap((batches) => batches.pipeline(commands))),
      ),
    transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      observe(
        "transaction",
        BatchExecutor.pipe(Effect.flatMap((batches) => batches.transaction(commands))),
      ),

    execute: executor.execute,
    executePrepared: executor.executePrepared,
    raw: (tokens: RedisCommand, contract: RawContract) => executor.execute(raw(tokens, contract)),
  };
};

export type RedisClient = ReturnType<typeof makeRedis>;

export class Redis extends Context.Service<Redis, RedisClient>()("@effect-kit/redis/Redis") {
  static readonly layer = Layer.effect(Redis, CommandExecutor.pipe(Effect.map(makeRedis)));
}
