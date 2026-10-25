import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import * as Commands from "#/commands/index";
import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { bytes, sent } from "#test/support/connection/Controlled";

it.effect("bounds active operations and snapshots mutable key bytes before routing waits", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled({ maxOperations: 1 });
    const key = bytes("foo");
    const read = yield* Effect.forkChild(client.redis.getBytes(key));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    key.set(bytes("bar"));

    expect(yield* Effect.flip(client.redis.get("foo"))).toMatchObject({
      reason: "capacity",
      delivery: "unsent",
    });
    yield* sent(a, ["GET", bytes("foo")], "$-1\r\n");
    yield* Fiber.join(read);
    expect(yield* client.snapshot).toMatchObject({ count: 0, bytes: 0 });
  }),
);

it.effect("whole-operation timeout releases admission and retires possibly-written ownership", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled({ operationTimeoutMillis: 100 });
    const read = yield* Effect.forkChild(Effect.result(client.redis.incr("foo")));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["INCR", "foo"]);
    yield* TestClock.adjust(100);

    expect(yield* Fiber.join(read)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ConnectionError", reason: "timeout", delivery: "possibly-written" },
    });
    expect(yield* client.snapshot).toMatchObject({ count: 0, bytes: 0 });
    expect((yield* a.observations).closed).toBe(1);
  }),
);

it.effect("cancellation retires a written request without redirecting its mutation", () =>
  Effect.gen(function* () {
    const { client, a, b } = yield* clusterControlled();
    const mutation = yield* Effect.forkChild(client.redis.incr("foo"));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["INCR", "foo"]);
    yield* Fiber.interrupt(mutation);

    expect((yield* a.observations).closed).toBe(1);
    expect((yield* b.observations).acquired).toBe(0);
    expect(yield* client.snapshot).toMatchObject({ count: 0 });
  }),
);

it.effect("coalesces concurrent discovery and does not advance revision for unchanged maps", () =>
  Effect.gen(function* () {
    const { client, seed } = yield* clusterControlled();
    const before = (yield* client.topology).revision;
    const refreshes = yield* Effect.forkChild(
      Effect.all([client.refresh, client.refresh, client.refresh], { concurrency: 3 }),
    );
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply());
    const replies = yield* Fiber.join(refreshes);

    expect(replies.map((reply) => reply.revision)).toEqual([before, before, before]);
    expect(yield* seed.written).toHaveLength(2);
    expect(Object.isFrozen(replies[0]?.shards)).toBe(true);
  }),
);

it.effect("bounds node acquisition while retaining a valid discovery snapshot", () =>
  Effect.gen(function* () {
    const { client, a } = yield* clusterControlled({ maxNodes: 1 });
    expect(yield* Effect.flip(client.redis.get("foo"))).toMatchObject({
      _tag: "ClusterError",
      reason: "capacity",
      delivery: "unsent",
    });
    expect((yield* a.observations).acquired).toBe(0);
    expect((yield* client.topology).shards).toHaveLength(1);
  }),
);

it.effect(
  "preflights WATCH, batches, caching and suppressed replies against the same lease slot",
  () =>
    Effect.gen(function* () {
      const { client, a } = yield* clusterControlled();
      const use = yield* Effect.forkChild(
        client.withSession({ key: "foo" }, (session) =>
          Effect.gen(function* () {
            const operations: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
              session.watch(["bar"]),
              session.caching("YES", Commands.get("bar")),
              session.withoutReplies([Commands.set("bar", "value")]),
              session.transaction([Commands.get("foo"), Commands.get("bar")]),
            ];
            for (const operation of operations) {
              expect(yield* Effect.flip(operation)).toMatchObject({
                _tag: "ClusterError",
                reason: "cross-slot",
                delivery: "unsent",
              });
            }
          }),
        ),
      );
      yield* sent(a, ["READWRITE"], "+OK\r\n");
      yield* Fiber.join(use);

      expect(yield* a.written).toHaveLength(1);
    }),
);

it.effect("close rejects retained clients and waits for native resource release", () =>
  Effect.gen(function* () {
    const { client, seed } = yield* clusterControlled();
    yield* client.close;

    expect((yield* seed.observations).closed).toBe(1);
    expect(yield* Effect.flip(client.redis.get("foo"))).toMatchObject({
      _tag: "ClusterError",
      reason: "closed",
    });
  }),
);
