import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { sent, bytes } from "#test/support/connection/Controlled";
import { poolFixture, waitForPool } from "#test/support/sessions/Pool";

it.effect(
  "SESSION-POOL: a released healthy connection is reused after write ownership drains",
  () =>
    Effect.gen(function* () {
      const { pool, primary, opens } = yield* poolFixture();
      for (let attempt = 0; attempt < 2; attempt++) {
        const request = yield* Effect.forkChild(
          pool.use("session", (wire) => wire.execute(["PING"])),
        );
        yield* sent(primary, ["PING"], "+PONG\r\n");
        expect(yield* Fiber.join(request)).toEqual({ _tag: "SimpleString", value: bytes("PONG") });
      }

      expect(opens()).toBe(1);
      expect(yield* pool.snapshot).toMatchObject({
        connections: 1,
        idle: 1,
        leased: 0,
        waiting: 0,
      });
      yield* pool.close;
      expect(yield* primary.observations).toMatchObject({ acquired: 1, closed: 1 });
    }),
);

it.effect("SESSION-POOL: bounded waiters cancel and expire without leaking capacity", () =>
  Effect.gen(function* () {
    const { pool, opens } = yield* poolFixture({
      maxSessionConnections: 1,
      maxWaiters: 1,
      leaseTimeoutMillis: 50,
    });
    const hold = yield* Deferred.make<void>();
    const owner = yield* Effect.forkChild(pool.use("session", () => Deferred.await(hold)));
    yield* waitForPool(pool, (snapshot) => snapshot.connections === 1);
    const waiter = yield* Effect.forkChild(pool.use("session", () => Effect.void));
    yield* waitForPool(pool, (snapshot) => snapshot.waiting === 1);

    expect(yield* Effect.flip(pool.use("session", () => Effect.void))).toMatchObject({
      reason: "pool-full",
    });
    yield* Fiber.interrupt(waiter);
    expect((yield* pool.snapshot).waiting).toBe(0);

    const timed = yield* Effect.forkChild(Effect.flip(pool.use("session", () => Effect.void)));
    yield* waitForPool(pool, (snapshot) => snapshot.waiting === 1);
    yield* TestClock.adjust(50);
    expect(yield* Fiber.join(timed)).toMatchObject({ reason: "lease-timeout", delivery: "unsent" });
    yield* Deferred.succeed(hold, undefined);
    yield* Fiber.join(owner);

    expect(opens()).toBe(1);
    expect(yield* pool.snapshot).toMatchObject({ waiting: 0, leased: 0, idle: 1 });
  }),
);

it.effect("SESSION-POOL: blocking leases have an independently bounded lane", () =>
  Effect.gen(function* () {
    const { pool, opens } = yield* poolFixture({
      maxSessionConnections: 1,
      maxBlockingConnections: 1,
    });
    const hold = yield* Deferred.make<void>();
    const blocked = yield* Effect.forkChild(pool.use("blocking", () => Deferred.await(hold)));
    yield* waitForPool(pool, (snapshot) => snapshot.connections === 1);

    yield* pool.use("session", () => Effect.void);
    expect(opens()).toBe(2);
    expect(yield* pool.snapshot).toMatchObject({ connections: 2, leased: 1, idle: 1 });
    yield* Deferred.succeed(hold, undefined);
    yield* Fiber.join(blocked);
  }),
);

it.effect("SESSION-POOL: closing wakes queued leases and rejects later acquisitions", () =>
  Effect.gen(function* () {
    const { pool, opens } = yield* poolFixture({ maxSessionConnections: 1 });
    const hold = yield* Deferred.make<void>();
    const owner = yield* Effect.forkChild(pool.use("session", () => Deferred.await(hold)));
    yield* waitForPool(pool, (snapshot) => snapshot.connections === 1);
    const waiter = yield* Effect.forkChild(Effect.flip(pool.use("session", () => Effect.void)));
    yield* waitForPool(pool, (snapshot) => snapshot.waiting === 1);

    yield* pool.close;
    expect(yield* Fiber.join(waiter)).toMatchObject({ reason: "closed" });
    expect(yield* Effect.flip(pool.use("session", () => Effect.void))).toMatchObject({
      reason: "closed",
    });
    expect(opens()).toBe(1);
    yield* Deferred.succeed(hold, undefined);
    yield* Fiber.join(owner);
  }),
);

it.effect("SESSION-POOL: cancellation after write retires before a replacement is leased", () =>
  Effect.gen(function* () {
    const { pool, primary, secondary, opens } = yield* poolFixture({ maxSessionConnections: 1 });
    const request = yield* Effect.forkChild(
      pool.use("session", (wire) => wire.execute(["INCR", "k"])),
    );
    yield* sent(primary, ["INCR", "k"]);
    yield* Fiber.interrupt(request);

    expect(yield* primary.observations).toMatchObject({ closed: 1 });
    const replacement = yield* Effect.forkChild(
      pool.use("session", (wire) => wire.execute(["PING"])),
    );
    yield* sent(secondary, ["PING"], "+PONG\r\n");
    yield* Fiber.join(replacement);
    expect(opens()).toBe(2);
  }),
);

it.effect(
  "SESSION-POOL: reply-before-write completion retains its lease within a cleanup deadline",
  () =>
    Effect.gen(function* () {
      const { pool, primary } = yield* poolFixture({ cleanupTimeoutMillis: 25 });
      const request = yield* Effect.forkChild(
        Effect.flip(pool.use("session", (wire) => wire.execute(["PING"]))),
      );
      yield* primary.nextWrite;
      yield* primary.receive(bytes("+PONG\r\n"));
      yield* waitForPool(pool, (snapshot) => snapshot.leased === 1);
      yield* TestClock.adjust(25);

      expect(yield* Fiber.join(request)).toMatchObject({ reason: "cleanup" });
      expect(yield* primary.observations).toMatchObject({ closed: 1 });
      expect(yield* pool.snapshot).toMatchObject({ leased: 0, connections: 0 });
    }),
);
