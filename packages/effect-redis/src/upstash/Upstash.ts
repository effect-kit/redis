import { Context, Effect, Layer } from "effect";

import { BatchExecutor } from "#/command/BatchExecutor";
import { CommandExecutor } from "#/command/Executor";
import { Redis, makeRedis } from "#/Redis";
import { decodeUpstashConfig } from "#/upstash/Config";
import type { UpstashConfigInput } from "#/upstash/Config";
import { makeHttpBatches, makeHttpExecutor } from "#/upstash/Executor";
import { makeHttpClient } from "#/upstash/http/Client";
import { UpstashEvents } from "#/upstash/sse/Events";
import { makeSubscriptions } from "#/upstash/sse/Subscription";

export const makeUpstash = Effect.fnUntraced(function* (input: UpstashConfigInput) {
  const http = yield* makeHttpClient(yield* decodeUpstashConfig(input));
  const executor = makeHttpExecutor(http);
  const batches = makeHttpBatches(http);

  return { redis: makeRedis(executor), executor, batches, events: makeSubscriptions(http) };
});

/** Provides ordinary commands and HTTP batches. Physical RedisSessions are intentionally separate. */
export const layer = (input: UpstashConfigInput) =>
  Layer.effectContext(
    makeUpstash(input).pipe(
      Effect.map(({ redis, executor, batches, events }) =>
        Context.make(Redis, redis).pipe(
          Context.add(CommandExecutor, executor),
          Context.add(BatchExecutor, batches),
          Context.add(UpstashEvents, events),
        ),
      ),
    ),
  );
