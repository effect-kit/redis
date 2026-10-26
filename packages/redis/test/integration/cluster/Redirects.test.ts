import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";

import { keySlot } from "#/cluster/Slot";
import { TransportError } from "#/errors/TransportError";
import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { sent } from "#test/support/connection/Controlled";

it.effect("routes binary-safe results through the existing scheduler", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled();
    const read = yield* Effect.forkChild(client.redis.getBytes("foo"));

    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["GET", "foo"]);
    yield* a.receive(new Uint8Array([36, 50, 13, 10, 0, 255, 13, 10]));

    expect(yield* Fiber.join(read)).toEqual(Option.some(new Uint8Array([0, 255])));
  }),
);

it.effect("MOVED refreshes ownership after definite rejection, then decodes once", () =>
  Effect.gen(function* () {
    const { client, seed, a, b } = yield* clusterControlled();
    const read = yield* Effect.forkChild(client.redis.get("foo"));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["GET", "foo"], `-MOVED ${keySlot("foo")} b:6379\r\n`);
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("b", "node-b"));
    yield* sent(b, ["READWRITE"], "+OK\r\n");
    yield* sent(b, ["GET", "foo"], "$3\r\nbar\r\n");

    expect(yield* Fiber.join(read)).toEqual(Option.some("bar"));
    expect((yield* client.topology).shards[0]?.primary.id).toBe("node-b");
  }),
);

it.effect("ASK fences ASKING with its command and leaves permanent ownership unchanged", () =>
  Effect.gen(function* () {
    const { client, a, b } = yield* clusterControlled();
    const read = yield* Effect.forkChild(client.redis.get("foo"));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["GET", "foo"], `-ASK ${keySlot("foo")} b:6379\r\n`);
    yield* sent(b, ["READWRITE"], "+OK\r\n");
    yield* sent(b, ["ASKING"], "+OK\r\n");
    yield* sent(b, ["GET", "foo"], "$1\r\nx\r\n");
    expect(yield* Fiber.join(read)).toEqual(Option.some("x"));

    const next = yield* Effect.forkChild(client.redis.get("foo"));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["GET", "foo"], "$1\r\ny\r\n");
    expect(yield* Fiber.join(next)).toEqual(Option.some("y"));
  }),
);

it.effect("bounds redirect loops and releases whole-operation admission", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled({ maxRedirects: 2 });
    const read = yield* Effect.forkChild(Effect.result(client.redis.get("foo")));
    for (let attempt = 0; attempt < 3; attempt++) {
      yield* sent(a, ["READWRITE"], "+OK\r\n");
      if (attempt > 0) yield* sent(a, ["ASKING"], "+OK\r\n");
      yield* sent(a, ["GET", "foo"], `-ASK ${keySlot("foo")} a:6379\r\n`);
    }
    expect(yield* Fiber.join(read)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ClusterError", reason: "redirect-limit", delivery: "replied" },
    });
    expect(yield* client.snapshot).toMatchObject({ count: 0, bytes: 0 });
  }),
);

it.effect("never retries uncertain mutations; new work refreshes separately", () =>
  Effect.gen(function* () {
    const { client, seed, a, b } = yield* clusterControlled();
    const increment = yield* Effect.forkChild(Effect.result(client.redis.incr("foo")));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["INCR", "foo"]);
    yield* a.failRead(new TransportError({ stage: "read", reason: "closed" }));

    expect(yield* Fiber.join(increment)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ConnectionError", delivery: "possibly-written" },
    });
    expect((yield* b.observations).acquired).toBe(0);

    const read = yield* Effect.forkChild(client.redis.get("foo"));
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("b", "node-b"));
    yield* sent(b, ["READWRITE"], "+OK\r\n");
    yield* sent(b, ["GET", "foo"], "$1\r\n1\r\n");
    expect(yield* Fiber.join(read)).toEqual(Option.some("1"));
  }),
);

it.effect("does not replay a completed reply after decoder failure", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled();
    const increment = yield* Effect.forkChild(Effect.result(client.redis.incr("foo")));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["INCR", "foo"], "$3\r\nbad\r\n");

    expect(yield* Fiber.join(increment)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ReplyError" },
    });
    expect(yield* a.written).toHaveLength(2);
  }),
);
