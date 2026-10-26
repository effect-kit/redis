import { Effect, Fiber, Redacted, Stream } from "effect";

import type { RedisClient } from "@effect-kit/redis";
import { UpstashEvents } from "@effect-kit/redis/upstash";

import { ensure } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";
import { assertUnsubscribed } from "#test/runners/providers/scenarios/Subscriptions";

export const events = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check, record }: ReturnType<typeof assertions>,
) {
  const subscriptions = yield* UpstashEvents;
  const channel = `${prefix}channel`;
  const subscription = yield* subscriptions.subscribe(channel);
  const receiving = yield* subscription.messages.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild,
  );

  yield* check("events.publish", redis.publish(channel, "héllo,comma,雪"), (reply) =>
    ensure(reply >= 1n, "publish"),
  );
  const messages = yield* Fiber.join(receiving).pipe(Effect.timeout(10_000));
  ensure(
    messages.length === 1 &&
      messages[0]?.channel === channel &&
      messages[0].message === "héllo,comma,雪",
    "sse-message",
  );
  record("events.sse-utf8-comma");
  yield* subscription.close;
  record("events.joined-close");

  const invalid = yield* Effect.result(subscriptions.subscribe(`${channel}\ninvalid`));
  ensure(
    invalid._tag === "Failure" &&
      invalid.failure._tag === "UpstashError" &&
      invalid.failure.delivery === "unsent",
    "sse-channel-guard",
  );
  record("events.invalid-channel-unsent");

  const marker = `${prefix}monitor`;
  const monitor = yield* subscriptions.monitor();
  const monitored = yield* monitor.messages.pipe(
    Stream.filter(
      (entry) => entry._tag === "Command" && Redacted.value(entry.commandLine).includes(marker),
    ),
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* redis.echo(marker);
  const diagnostic = yield* Fiber.join(monitored).pipe(Effect.timeout(10_000));
  ensure(diagnostic.length === 1 && diagnostic[0]?._tag === "Command", "monitor-command");
  yield* monitor.close;
  record("events.monitor-joined-close");

  const multiline = yield* subscriptions.subscribe(channel);
  const multilineReply = yield* multiline.messages.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* redis.publish(channel, "first-line\nsecond-line");
  const received = yield* Fiber.join(multilineReply).pipe(Effect.timeout(10_000));
  yield* multiline.close;
  ensure(
    received.length === 1 &&
      (received[0]?.message === "first-line" || received[0]?.message === "first-line\nsecond-line"),
    "sse-newline-contract",
  );
  if (received[0]?.message === "first-line")
    record(
      "events.newline-transport-limit",
      "limited",
      "Hosted SSE framing truncates newline-containing messages; use native Pub/Sub for lossless payloads",
    );
  else record("events.newline-preserved");

  const binary = yield* subscriptions.subscribe(channel);
  const binaryReply = yield* binary.messages.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.result,
    Effect.forkChild,
  );
  yield* redis.publish(channel, new Uint8Array([255]));
  const rejected = yield* Fiber.join(binaryReply).pipe(Effect.timeout(10_000));
  yield* binary.close;
  ensure(
    rejected._tag === "Failure" &&
      rejected.failure._tag === "UpstashError" &&
      rejected.failure.reason === "encoding",
    "sse-binary-contract",
  );
  record(
    "events.binary-transport-limit",
    "limited",
    "Invalid UTF8 SSE payloads fail explicitly; native Pub/Sub preserves bytes",
  );
  yield* assertUnsubscribed(redis, channel);
  record("events.server-unsubscribed");
});
