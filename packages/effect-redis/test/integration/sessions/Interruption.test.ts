import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, Redacted } from "effect";

import { BatchError } from "#/errors/BatchError";
import { Commands } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "SESSION-UNKNOWN: cancellation during EXEC preserves uncertainty and the interruption",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(sessions.transaction([Commands.incr("k")]));
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "k"], "+QUEUED\r\n");
      yield* sent(primary, ["EXEC"]);
      yield* Fiber.interrupt(request);
      const exit = yield* Fiber.await(request);
      if (exit._tag !== "Failure") return yield* Effect.die("Expected interruption");
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      const failure = Cause.findError(exit.cause);
      if (failure._tag !== "Success" || !(failure.success instanceof BatchError))
        return yield* Effect.die("Missing EXEC evidence");
      expect(failure.success).toMatchObject({ phase: "transaction-exec", execution: "unknown" });
      expect(Redacted.value(failure.success.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
      ]);
      expect(yield* primary.observations).toMatchObject({ closed: 1 });
    }),
);

it.effect(
  "SESSION-UNKNOWN: interruption before EXEC retains queued evidence without claiming execution",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture(
        {},
        { limits: { maxInFlightCommands: 1 } },
      );
      const request = yield* Effect.forkChild(
        sessions.transaction([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
      );
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "a"], "+QUEUED\r\n");
      yield* sent(primary, ["INCR", "b"]);
      yield* Fiber.interrupt(request);
      const exit = yield* Fiber.await(request);
      if (exit._tag !== "Failure") return yield* Effect.die("Expected interruption");
      const failure = Cause.findError(exit.cause);
      if (failure._tag !== "Success" || !(failure.success instanceof BatchError))
        return yield* Effect.die("Missing queue evidence");
      expect(failure.success.execution).toBe("not-executed");
      expect(Redacted.value(failure.success.outcomes)).toMatchObject([
        { _tag: "Replied", index: 0 },
        { _tag: "Unknown", index: 1 },
        { _tag: "Unsent", index: 2 },
      ]);
    }),
);

it.effect(
  "SESSION-STATE: nested transaction attempts fail explicitly while the first owns its lease",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const inside =
        yield* Deferred.make<Parameters<Parameters<typeof sessions.withSession>[0]>[0]>();
      const request = yield* Effect.forkChild(
        sessions.withSession((session) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(inside, session);
            return yield* session.transaction([Commands.incr("k")]);
          }),
        ),
      );
      const session = yield* Deferred.await(inside);
      yield* sent(primary, ["MULTI"], "+OK\r\n");
      yield* sent(primary, ["INCR", "k"]);
      expect(yield* Effect.flip(session.transaction([]))).toMatchObject({
        reason: "transaction-active",
        delivery: "unsent",
      });
      yield* primary.receive(new TextEncoder().encode("+QUEUED\r\n"));
      yield* sent(primary, ["EXEC"], "*1\r\n:1\r\n");
      yield* Fiber.join(request);
    }),
);
