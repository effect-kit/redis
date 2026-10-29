import { expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";

import { makeConnection } from "#/connection/Connection";
import { makeDeadlines } from "#/connection/deadline/Coordinator";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import {
  bytes,
  controlled,
  reconnecting,
  sent,
  waitForSnapshot,
} from "#test/support/connection/Controlled";

const unexpectedDefect = () => {
  throw new Error("Unexpected deadline worker defect");
};

it.effect("a caller-local Clock keeps control of that request's timeout", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const clock = yield* Clock.Clock;
    let localSleeps = 0;
    const request = yield* Effect.forkChild(
      connection.executeOrdinary(["PING"]).pipe(
        Effect.provideService(Clock.Clock, {
          ...clock,
          sleep: (duration) => {
            localSleeps++;
            return clock.sleep(duration);
          },
        }),
      ),
    );
    yield* sent(fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(request);
    expect(localSleeps).toBe(1);
  }),
);

it.effect("earlier registrations wake the owner without losing later deadlines", () =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const deadlines = yield* makeDeadlines(scope, 8, unexpectedDefect);
    const expired: string[] = [];
    deadlines.schedule(100, () => expired.push("late"));
    yield* TestClock.adjust(20);
    deadlines.schedule(10, () => expired.push("early"));
    yield* TestClock.adjust(10);
    expect(expired).toEqual(["early"]);
    yield* TestClock.adjust(70);
    expect(expired).toEqual(["early", "late"]);
    expect(deadlines.size()).toBe(0);
  }),
);

it.effect("completed registrations do not re-arm timers or retain stale entries", () =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const scope = yield* Scope.fork(yield* Effect.scope);
    let sleeps = 0;
    const deadlines = yield* makeDeadlines(scope, 4, unexpectedDefect).pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep: (duration) => {
          sleeps++;
          return clock.sleep(duration);
        },
      }),
    );
    const expired: number[] = [];
    const cancel = deadlines.schedule(100, () => expired.push(0));
    yield* TestClock.adjust(0);
    const initiallyArmed = sleeps;
    cancel();

    for (let index = 1; index <= 1000; index++) {
      const remove = deadlines.schedule(100, () => expired.push(index));
      remove();
      remove();
    }
    yield* TestClock.adjust(0);
    expect(deadlines.size()).toBe(0);
    expect(sleeps).toBe(initiallyArmed);
    yield* TestClock.adjust(100);
    expect(expired).toEqual([]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("removing arbitrary deadlines preserves expiry order and scoped cleanup", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const deadlines = yield* makeDeadlines(scope, 64, unexpectedDefect);
    const expired: number[] = [];
    const expected: number[] = [];
    for (let index = 0; index < 64; index++) {
      const remove = deadlines.schedule(100 + (index % 11), () => expired.push(index));
      if (index % 2 === 0) expected.push(index);
      else remove();
    }
    yield* TestClock.adjust(200);
    expect(expired).toEqual(expected.toSorted((a, b) => (a % 11) - (b % 11) || a - b));
    deadlines.schedule(100, () => expired.push(1000));
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust(200);
    expect(expired).not.toContain(1000);
    expect(deadlines.size()).toBe(0);
  }),
);

it.effect("a request deadline wakes a reconnect waiter without sending expired work", () =>
  Effect.gen(function* () {
    const fixtures = yield* reconnecting();
    const [first, second] = fixtures.fixtures;
    if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");
    const transport = yield* Transport.pipe(Effect.provide(fixtures.layer));
    const started = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    let opens = 0;
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      protocol: "resp2",
      commandTimeoutMillis: 100,
    });
    const connection = yield* makeConnection(config).pipe(
      Effect.provideService(Transport, {
        open: (cfg) =>
          Effect.gen(function* () {
            if (++opens === 2) {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(gate);
            }
            return yield* transport.open(cfg);
          }),
      }),
    );
    yield* first.end;
    yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");
    const expired = yield* Effect.forkChild(
      Effect.flip(connection.executeOrdinary(["INCR", "expired"])),
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust(100);
    expect(yield* Fiber.join(expired)).toMatchObject({ reason: "timeout", delivery: "unsent" });
    yield* Deferred.succeed(gate, undefined);
    const future = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
    yield* sent(second, ["PING"], "+PONG\r\n");
    yield* Fiber.join(future);
    expect(yield* second.written).toHaveLength(1);
  }),
);

it.effect(
  "an early successful reply cannot leave an unfinished write alive past its deadline",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({ commandTimeoutMillis: 100 });
      const reply = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* fixture.nextWrite;
      yield* fixture.receive(bytes("+PONG\r\n"));
      expect(yield* Fiber.join(reply)).toMatchObject({ _tag: "SimpleString" });
      yield* TestClock.adjust(100);
      yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");
      expect(yield* connection.snapshot).toMatchObject({ inFlightBytes: 0, unknownOutcomes: 0 });
      expect((yield* fixture.observations).closed).toBe(1);
    }),
);
