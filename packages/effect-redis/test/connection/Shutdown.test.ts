import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import { controlled, sent, waitForSnapshot } from "#test/support/connection/Controlled";

it.effect("OWNERSHIP-07: graceful close drains admitted work and rejects fresh admission", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const request = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
    yield* sent(fixture, ["PING"]);
    const closing = yield* Effect.forkChild(connection.close);
    yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "draining");
    const fresh = yield* Effect.result(connection.executeOrdinary(["PING"]));
    expect(Result.isFailure(fresh) && fresh.failure).toMatchObject({
      _tag: "ConnectionError",
      reason: "closed",
      delivery: "unsent",
    });
    yield* fixture.receive(new TextEncoder().encode("+PONG\r\n"));
    yield* Fiber.join(request);
    yield* Fiber.join(closing);
    yield* connection.close;
    yield* connection.abort;
    expect(yield* connection.snapshot).toMatchObject({
      state: "closed",
      queuedCommands: 0,
      inFlightCommands: 0,
    });
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("OWNERSHIP-08: graceful deadline aborts stalled work and wakes every caller", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({}, { shutdownTimeoutMillis: 100 });
    const request = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
    yield* sent(fixture, ["PING"]);
    const closing = yield* Effect.forkChild(Effect.result(connection.close));
    yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "draining");
    yield* TestClock.adjust(100);
    const close = yield* Fiber.join(closing);
    expect(Result.isFailure(close) && close.failure.reason).toBe("shutdown-timeout");
    const reply = yield* Fiber.join(request);
    expect(Result.isFailure(reply) && reply.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "possibly-written",
    });
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("OWNERSHIP-09: interruption while draining still awaits cleanup", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const request = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
    yield* sent(fixture, ["PING"]);
    const closing = yield* Effect.forkChild(connection.close);
    yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "draining");
    yield* Fiber.interrupt(closing);
    yield* Fiber.join(request);
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect(
  "OWNERSHIP-11: repeated scopes finish interrupted waiters and close each handle once",
  () =>
    Effect.gen(function* () {
      for (let iteration = 0; iteration < 12; iteration++) {
        const state = yield* Effect.scoped(
          Effect.gen(function* () {
            const { fixture, connection } = yield* controlled({
              limits: { maxInFlightCommands: 1 },
            });
            const written = yield* Effect.forkChild(
              Effect.result(connection.executeOrdinary(["PING"])),
            );
            yield* sent(fixture, ["PING"]);
            const queued = yield* Effect.forkChild(
              Effect.result(connection.executeOrdinary(["PING"])),
            );
            yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
            yield* connection.abort;
            expect(Result.isFailure(yield* Fiber.join(written))).toBe(true);
            expect(Result.isFailure(yield* Fiber.join(queued))).toBe(true);
            expect(yield* connection.snapshot).toMatchObject({
              queuedCommands: 0,
              queuedBytes: 0,
              inFlightCommands: 0,
              inFlightBytes: 0,
              retiredGenerations: 1,
            });
            return fixture;
          }),
        );
        expect((yield* state.observations).closed).toBe(1);
      }
    }),
);
