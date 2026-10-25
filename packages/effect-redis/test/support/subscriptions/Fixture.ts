import { Effect } from "effect";

import { decodeRedisConfig, makeRedisPubSub } from "#/index";
import type { SubscriptionOptions } from "#/subscriptions/Options";
import { reconnecting } from "#test/support/connection/Controlled";

export const pubsubFixture = Effect.fnUntraced(function* (
  options: SubscriptionOptions = {},
  protocol: "resp2" | "resp3" = "resp2",
) {
  const fixture = yield* reconnecting();
  const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol });
  const pubsub = yield* makeRedisPubSub(config, { reconnectDelayMillis: 0, ...options }).pipe(
    Effect.provide(fixture.layer),
  );
  const [primary, secondary] = fixture.fixtures;
  if (primary === undefined || secondary === undefined)
    return yield* Effect.die("Missing controlled event sockets");

  const finish = Effect.gen(function* () {
    for (const physical of fixture.fixtures) yield* physical.end;
    while (true) {
      const counts = yield* Effect.forEach(fixture.fixtures, (physical) => physical.observations);
      if (counts.every((count) => count.closed === count.acquired)) return;
      yield* Effect.yieldNow;
    }
  });

  return { ...fixture, primary, secondary, config, pubsub, finish };
});

export const acknowledgment = (kind: string, target = "c", count = 1) =>
  `*3\r\n$${kind.length}\r\n${kind}\r\n$${target.length}\r\n${target}\r\n:${count}\r\n`;

export const channelMessage = (value: string, channel = "c") =>
  `*3\r\n$7\r\nmessage\r\n$${channel.length}\r\n${channel}\r\n$${value.length}\r\n${value}\r\n`;
