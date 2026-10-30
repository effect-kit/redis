import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Redacted } from "effect";

import { BatchError } from "#/errors/BatchError";
import { Commands } from "#/index";
import { PipelinedTransactions } from "#/profiles/Transactions";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

const fixture = (limits: Record<string, number> = {}) =>
  sessionFixture({}, { limits }).pipe(Effect.provideService(PipelinedTransactions, true));

it.effect("verified transactions submit EXEC without waiting for queue acknowledgments", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* fixture();
    const running = yield* Effect.forkChild(sessions.transaction([Commands.incr("a")]));

    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "a"]);
    yield* sent(primary, ["EXEC"], "+QUEUED\r\n*1\r\n:1\r\n");

    expect(yield* Fiber.join(running)).toMatchObject({
      _tag: "Committed",
      results: [{ success: 1n }],
    });
  }),
);

it.effect("pipelining still fences every mutation behind a successful MULTI", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* fixture();
    const running = yield* Effect.forkChild(
      Effect.flip(sessions.transaction([Commands.incr("a")])),
    );
    yield* sent(primary, ["MULTI"], "-NOPERM hidden\r\n");

    expect(yield* Fiber.join(running)).toMatchObject({ _tag: "ServerError", code: "NOPERM" });
    expect(yield* primary.written).toHaveLength(1);
  }),
);

it.effect.each([
  { exec: "-EXECABORT hidden\r\n", execution: "not-executed", closed: 0 },
  { exec: "*1\r\n:1\r\n", execution: "unknown", closed: 1 },
])(
  "queue errors require an explicit abort before claiming $execution",
  ({ exec, execution, closed }) =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* fixture();
      const running = yield* Effect.forkChild(
        Effect.flip(sessions.transaction([Commands.incr("a")])),
      );
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"]);
      yield* sent(primary, ["EXEC"], `-NOPERM hidden\r\n${exec}`);

      expect(yield* Fiber.join(running)).toMatchObject({
        _tag: "TransactionError",
        reason: "queue-rejected",
        execution,
      });
      expect((yield* primary.observations).closed).toBe(closed);
      if (closed === 0) {
        const next = yield* Effect.forkChild(sessions.withSession((session) => session.ping()));
        yield* sent(primary, ["PING"], "+PONG\r\n");
        yield* Fiber.join(next);
      }
    }),
);

it.effect("denied EXEC retires uncertain transaction state", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* fixture();
    const running = yield* Effect.forkChild(
      Effect.flip(sessions.transaction([Commands.incr("a")])),
    );
    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "a"]);
    yield* sent(primary, ["EXEC"], "+QUEUED\r\n-NOPERM hidden\r\n");

    expect(yield* Fiber.join(running)).toMatchObject({
      _tag: "TransactionError",
      reason: "exec-rejected",
      execution: "unknown",
    });
    expect((yield* primary.observations).closed).toBe(1);
  }),
);

it.effect("an extra EXEC slot that cannot fit falls back before writing the queue", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* fixture({ maxQueuedCommands: 1 });
    const running = yield* Effect.forkChild(sessions.transaction([Commands.incr("a")]));
    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
    yield* sent(primary, ["EXEC"], "*1\r\n:1\r\n");

    expect(yield* Fiber.join(running)).toMatchObject({
      _tag: "Committed",
      results: [{ success: 1n }],
    });
    expect(yield* primary.written).toHaveLength(3);
  }),
);

it.effect("a lost EXEC reply is unknown and never replays its mutations", () =>
  Effect.gen(function* () {
    const { sessions, primary, opens } = yield* fixture();
    const running = yield* Effect.forkChild(
      Effect.flip(sessions.transaction([Commands.incr("a")])),
    );
    yield* sent(primary, ["MULTI"], "+OK\r\n");
    yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
    yield* sent(primary, ["EXEC"]);
    yield* primary.end;

    const failure = yield* Fiber.join(running);
    expect(failure).toMatchObject({
      _tag: "BatchError",
      phase: "transaction-exec",
      execution: "unknown",
    });
    if (!(failure instanceof BatchError)) return yield* Effect.die(failure);
    expect(Redacted.value(failure.outcomes)).toHaveLength(1);
    expect(opens()).toBe(1);
  }),
);

it.effect.each([false, true])(
  "cancellation tracks whether EXEC itself was submitted (%s)",
  (submitted) =>
    Effect.gen(function* () {
      // A single in-flight slot makes the later EXEC write an observable barrier
      // proving that the queue acknowledgment has been processed.
      const { sessions, primary } = yield* fixture({ maxInFlightCommands: 1 });
      const running = yield* Effect.forkChild(sessions.transaction([Commands.incr("a")]));
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"], submitted ? "+QUEUED\r\n" : undefined);
      if (submitted) yield* sent(primary, ["EXEC"]);

      yield* Fiber.interrupt(running);
      const exit = yield* Fiber.await(running);
      if (Exit.isSuccess(exit)) return yield* Effect.die("Expected interrupted transaction");
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);

      const evidence = exit.cause.reasons.flatMap((reason) => {
        const error = Cause.isFailReason(reason)
          ? reason.error
          : Cause.isDieReason(reason)
            ? reason.defect
            : undefined;
        return error instanceof BatchError ? [error] : [];
      });
      expect(evidence.length).toBeGreaterThan(0);
      for (const error of evidence) {
        expect(error.execution).toBe(submitted ? "unknown" : "not-executed");
        expect(Redacted.value(error.outcomes)).toHaveLength(1);
        expect(Redacted.value(error.outcomes)).toMatchObject([
          { _tag: submitted ? "Replied" : "Unknown" },
        ]);
      }
      expect((yield* primary.observations).closed).toBe(1);
    }),
);
