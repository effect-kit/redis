import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Redacted, Scope } from "effect";

import { TransportError } from "#/errors/TransportError";
import { Commands, ServerError } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sentinelControlled } from "#test/support/sentinel/Controlled";

it.effect("application decoder errors never enter Sentinel recovery", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const command = {
      prepare: Commands.incr("key").prepare.pipe(
        Effect.map((intent) => ({
          ...intent,
          decode: () =>
            Effect.fail(
              new ServerError({
                delivery: "replied",
                code: "READONLY",
                reply: Redacted.make({}),
              }),
            ),
        })),
      ),
    };
    const operation = yield* Effect.forkChild(Effect.flip(fixture.client.redis.execute(command)));
    const data = yield* fixture.data();
    yield* sent(data.fixture, ["INCR", "key"], ":1\r\n");

    expect(yield* Fiber.join(operation)).toMatchObject({ _tag: "ServerError", code: "READONLY" });
    expect(yield* fixture.client.snapshot).toMatchObject({ obsolete: false, revision: 1 });
    expect(fixture.acquired()).toBe(5);
  }),
);

it.effect("a real READONLY reply invalidates the generation without replaying its command", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const operation = yield* Effect.forkChild(Effect.flip(fixture.client.redis.incr("key")));
    const data = yield* fixture.data();
    yield* sent(data.fixture, ["INCR", "key"], "-READONLY synthetic-role-change\r\n");

    expect(yield* Fiber.join(operation)).toMatchObject({ _tag: "ServerError", code: "READONLY" });
    expect(yield* fixture.client.snapshot).toMatchObject({ obsolete: true });
    expect(fixture.acquired()).toBe(5);
  }),
);

it.effect(
  "explicit control mutations retain unknown wire outcomes and share bounded admission",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled({ maxOperations: 1 });
      const control = fixture.client.sentinel(0);
      const first = yield* Effect.forkChild(
        Effect.flip(control.execute(Commands.sentinelFailover("cache"))),
      );
      const wire = yield* fixture.next;
      yield* sent(wire.fixture, ["SENTINEL", "FAILOVER", "cache"]);

      expect(yield* Effect.flip(control.execute(Commands.sentinelMyId()))).toMatchObject({
        reason: "capacity",
      });
      yield* wire.fixture.failRead(new TransportError({ stage: "read", reason: "io" }));
      expect(yield* Fiber.join(first)).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(fixture.acquired()).toBe(3);
    }),
);

it.effect("physical cleanup defects poison all replacement acquisition", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const fixture = yield* sentinelControlled({}, { cleanupDefectAt: 5 }).pipe(
      Scope.provide(scope),
    );
    const operation = yield* Effect.forkChild(Effect.exit(fixture.client.redis.get("key")));
    const physical = yield* fixture.data();
    yield* sent(physical.fixture, ["GET", "key"]);
    yield* physical.fixture.failRead(new TransportError({ stage: "read", reason: "io" }));

    expect(Exit.hasDies(yield* Fiber.join(operation))).toBe(true);
    expect(Exit.hasDies(yield* Effect.exit(fixture.client.redis.get("other")))).toBe(true);
    expect(fixture.acquired()).toBe(5);
    yield* Effect.exit(Scope.close(scope, Exit.void));
  }),
);

it.effect(
  "client close retires in-flight Sentinel controls and prevents retained executors reopening sockets",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled();
      const control = fixture.client.sentinel(0);
      const waiting = yield* Effect.forkChild(
        Effect.flip(control.execute(Commands.sentinelFailover("cache"))),
      );
      const physical = yield* fixture.next;
      yield* sent(physical.fixture, ["SENTINEL", "FAILOVER", "cache"]);
      yield* fixture.client.close;

      expect(yield* Fiber.join(waiting)).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect((yield* physical.fixture.observations).closed).toBe(1);
      expect(yield* Effect.flip(control.execute(Commands.sentinelMyId()))).toMatchObject({
        reason: "closed",
      });
      expect(fixture.acquired()).toBe(3);
    }),
);
