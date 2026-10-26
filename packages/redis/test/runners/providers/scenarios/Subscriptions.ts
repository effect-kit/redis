import { Effect } from "effect";

import type { RedisClient } from "@effect-kit/redis";

import { ensure } from "#test/runners/providers/scenarios/Assertions";

/** HTTP cancellation can reach the provider after local body teardown; poll only read-only state. */
export const assertUnsubscribed = Effect.fnUntraced(function* (
  redis: RedisClient,
  channel: string,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const counts = yield* redis.pubsubNumSub([channel]);
    if (counts.length === 1 && counts[0]?.[1] === 0n) return;
    yield* Effect.sleep(50);
  }
  ensure(false, "subscription-server-cleanup");
});
