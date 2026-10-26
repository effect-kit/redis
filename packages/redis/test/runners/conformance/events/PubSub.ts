import assert from "node:assert/strict";

import { Effect, Stream } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const pubsub = Effect.fnUntraced(function* ({
  pubsub: subscriptions,
  prefix,
  check,
  record,
  policy,
}: Client) {
  const C = core.Commands;
  const channel = `${prefix}:channel`;
  const first = yield* subscriptions.subscribe([channel]);
  const second = yield* subscriptions.subscribe([channel]);
  const binary = new Uint8Array([0, 255, 128]);

  yield* check("pubsub.shared-interest", C.pubsubNumSub([channel, `${prefix}:absent`]), [
    [bytes(channel), 1n],
    [bytes(`${prefix}:absent`), 0n],
  ]);
  yield* check("pubsub.channels", C.pubsubChannels(`${prefix}:*`), [bytes(channel)]);
  yield* check("pubsub.publish", C.publish(channel, binary), 1n);
  const messages = yield* Stream.runCollect(first.messages.pipe(Stream.take(1)));
  assert.deepEqual(messages[0]?.payload, binary);
  assert.deepEqual(
    (yield* Stream.runCollect(second.messages.pipe(Stream.take(1))))[0]?.payload,
    binary,
  );
  record("pubsub.binary-fanout", "SUBSCRIBE");

  const pattern = yield* subscriptions.psubscribe([`${prefix}:*`]);
  yield* check("pubsub.pattern-count", C.pubsubNumPat(), 1n);
  yield* check("pubsub.overlap", C.publish(channel, "overlap"), 2n);
  const patterns = yield* Stream.runCollect(pattern.messages.pipe(Stream.take(1)));
  assert.equal(patterns[0]?._tag, "PatternMessage");
  assert.deepEqual(patterns[0]?.payload, bytes("overlap"));
  record("pubsub.pattern", "PSUBSCRIBE");

  yield* first.close();
  yield* check(
    "pubsub.retained-interest",
    C.pubsubNumSub([channel]),
    [[bytes(channel), policy.engine === "dragonfly" ? 2n : 1n]],
    policy.engine === "dragonfly" ? "different" : "passed",
  );
  yield* second.close();
  yield* pattern.close();
  yield* check("pubsub.closed", C.pubsubNumSub([channel]), [[bytes(channel), 0n]]);
});
