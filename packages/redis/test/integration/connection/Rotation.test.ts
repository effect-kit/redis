import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { nativeCredentialFixture } from "#test/support/credentials/Native";

it.effect(
  "credential expiry alone leaves an authenticated connection valid under reconnect policy",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture();
      yield* TestClock.adjust(1001);
      expect((yield* fixture.first.observations).closed).toBe(0);

      const ping = yield* fixture.redis.ping().pipe(Effect.forkChild);
      yield* sent(fixture.first, ["PING"], "+PONG\r\n");
      yield* Fiber.join(ping);
      expect(fixture.calls()).toBe(1);
      expect(fixture.opens()).toBe(1);
    }),
);

it.effect(
  "explicit expiry retirement preserves a written mutation's unknown outcome and only refreshes future work",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture({
        mode: "token-expiry",
        retireBeforeMillis: 0,
      });
      const mutation = yield* fixture.redis.incr("counter").pipe(Effect.forkChild);
      yield* sent(fixture.first, ["INCR", "counter"]);

      yield* TestClock.adjust(1000);
      expect(yield* Effect.flip(Fiber.join(mutation))).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(fixture.opens()).toBe(1);
      const ping = yield* fixture.redis.ping().pipe(Effect.forkChild);
      yield* sent(fixture.second, ["AUTH", "synthetic-2"], "+OK\r\n");
      yield* sent(fixture.second, ["PING"], "+PONG\r\n");
      yield* Fiber.join(ping);
      expect(fixture.calls()).toBe(2);
    }),
);

it.effect(
  "an expiring WATCH/EXEC lease retires without interleaved AUTH or replaying its EXEC",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture({
        mode: "token-expiry",
        retireBeforeMillis: 0,
      });
      const transaction = yield* fixture.sessions
        .withSession((session) =>
          Effect.gen(function* () {
            yield* session.watch(["counter"]);
            return yield* session.transaction([Commands.incr("counter")]);
          }),
        )
        .pipe(Effect.forkChild);
      yield* sent(fixture.second, ["AUTH", "synthetic-1"], "+OK\r\n");
      yield* sent(fixture.second, ["WATCH", "counter"], "+OK\r\n");
      yield* sent(fixture.second, ["MULTI"], "+OK\r\n");
      yield* sent(fixture.second, ["INCR", "counter"], "+QUEUED\r\n");
      yield* sent(fixture.second, ["EXEC"]);

      yield* TestClock.adjust(1000);
      const error = yield* Effect.flip(Fiber.join(transaction));
      expect(error).toMatchObject({
        _tag: "BatchError",
        phase: "transaction-exec",
        execution: "unknown",
      });
      if (error._tag === "BatchError")
        expect(Redacted.value(error.outcomes)).toMatchObject([{ _tag: "Unknown", index: 0 }]);
      expect(fixture.calls()).toBe(1);
      expect(fixture.opens()).toBe(2);
    }),
);

it.effect("deliberate rotation retires owned sockets and fences their old credential cache", () =>
  Effect.gen(function* () {
    const fixture = yield* nativeCredentialFixture();
    const mutation = yield* fixture.redis.incr("counter").pipe(Effect.forkChild);
    yield* sent(fixture.first, ["INCR", "counter"]);

    yield* fixture.identity.rotate;
    expect(yield* Effect.flip(Fiber.join(mutation))).toMatchObject({
      delivery: "possibly-written",
    });
    const ping = yield* fixture.redis.ping().pipe(Effect.forkChild);
    yield* sent(fixture.second, ["AUTH", "synthetic-2"], "+OK\r\n");
    yield* sent(fixture.second, ["PING"], "+PONG\r\n");
    yield* Fiber.join(ping);
    expect((yield* fixture.identity.snapshot).revision).toBe(1);
  }),
);

it.effect("maximum socket age is independent of the token's acceptance expiry", () =>
  Effect.gen(function* () {
    const fixture = yield* nativeCredentialFixture({ mode: "max-age", maxAgeMillis: 2000 });
    yield* TestClock.adjust(1500);
    expect((yield* fixture.first.observations).closed).toBe(0);
    yield* TestClock.adjust(500);

    const ping = yield* fixture.redis.ping().pipe(Effect.forkChild);
    yield* sent(fixture.second, ["AUTH", "synthetic-2"], "+OK\r\n");
    yield* sent(fixture.second, ["PING"], "+PONG\r\n");
    yield* Fiber.join(ping);
    expect((yield* fixture.first.observations).closed).toBe(1);
  }),
);

it.effect(
  "refresh acceptance covers the socket retirement margin even with a shorter source margin",
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeCredentialFixture({
        mode: "token-expiry",
        retireBeforeMillis: 100,
      });
      yield* TestClock.adjust(900);
      const future = yield* fixture.redis.ping().pipe(Effect.forkChild);
      yield* sent(fixture.second, ["AUTH", "synthetic-2"], "+OK\r\n");
      yield* sent(fixture.second, ["PING"], "+PONG\r\n");
      yield* Fiber.join(future);
      expect(fixture.calls()).toBe(2);
    }),
);
