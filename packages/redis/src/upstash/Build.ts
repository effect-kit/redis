import { Context, Effect } from "effect";

import { BatchExecutor } from "#/command/BatchExecutor";
import { CommandExecutor } from "#/command/Executor";
import { Redis, scopedRedis } from "#/Redis";
import type { UpstashSettings } from "#/upstash/Config";
import { makeHttpBatches, makeHttpExecutor } from "#/upstash/Executor";
import { makeHttpClient } from "#/upstash/http/Client";
import type { HttpClientOptions } from "#/upstash/http/Client";
import { UpstashEvents } from "#/upstash/sse/Events";
import { makeSubscriptions } from "#/upstash/sse/Subscription";

export const makeUpstashServices = Effect.fnUntraced(function* (
  config: UpstashSettings,
  options: HttpClientOptions,
) {
  const http = yield* makeHttpClient(config, options);
  const executor = makeHttpExecutor(http);
  const batches = makeHttpBatches(http);
  return {
    http,
    client: {
      redis: yield* scopedRedis(executor, batches),
      executor,
      batches,
      events: makeSubscriptions(http),
    },
  };
});

export const upstashContext = ({
  redis,
  executor,
  batches,
  events,
}: Effect.Success<ReturnType<typeof makeUpstashServices>>["client"]) =>
  Context.make(Redis, redis).pipe(
    Context.add(CommandExecutor, executor),
    Context.add(BatchExecutor, batches),
    Context.add(UpstashEvents, events),
  );
