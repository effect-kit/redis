import { expect, it } from "@effect/vitest";
import { Cause, Effect, Fiber, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";

import { BatchError } from "#/errors/BatchError";
import { Commands } from "#/index";
import { encodeBatch } from "#/protocol/encodeBatch";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect("pipeline groups physical writes within in-flight limits and retains reply order", () =>
  Effect.gen(function* () {
    const { sessions, primary, config } = yield* sessionFixture(
      {},
      { limits: { maxInFlightCommands: 2 } },
    );
    const request = yield* Effect.forkChild(
      sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
    );
    const first = yield* primary.nextWrite;
    expect(first.bytes).toEqual(
      Result.getOrThrow(
        encodeBatch(
          [
            ["INCR", "a"],
            ["INCR", "b"],
          ],
          config.limits,
        ),
      ),
    );

    // Replies may arrive before the native write callback releases the group's byte ownership.
    yield* primary.receive(bytes(":1\r\n:2\r\n"));
    yield* first.accept(first.bytes.length);
    yield* sent(primary, ["INCR", "c"], ":3\r\n");

    expect(yield* Fiber.join(request)).toEqual([
      Result.succeed(1n),
      Result.succeed(2n),
      Result.succeed(3n),
    ]);
  }),
);

it.effect(
  "interruption of a partial compound write retains unknown and unsent slots without replay",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, secondary, opens } = yield* sessionFixture(
        {},
        { limits: { maxInFlightCommands: 2 } },
      );
      const request = yield* Effect.forkChild(
        sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
      );
      const first = yield* primary.nextWrite;
      yield* first.accept(1);
      yield* Fiber.interrupt(request);

      const exit = yield* Fiber.await(request);
      if (exit._tag !== "Failure") return yield* Effect.die("Expected interruption");
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      const failure = Cause.findError(exit.cause);
      if (failure._tag !== "Success" || !(failure.success instanceof BatchError))
        return yield* Effect.die("Expected partial batch evidence");
      expect(Redacted.value(failure.success.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
        { _tag: "Unknown", index: 1 },
        { _tag: "Unsent", index: 2 },
      ]);

      const future = yield* Effect.forkChild(sessions.pipeline([Commands.incr("future")]));
      yield* sent(secondary, ["INCR", "future"], ":1\r\n");
      expect(yield* Fiber.join(future)).toEqual([Result.succeed(1n)]);
      expect(opens()).toBe(2);
      expect((yield* primary.observations).acceptedBytes).toBe(1);
    }),
);

it.effect(
  "a grouped-write deadline preserves an early reply while retiring the remaining slots",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture(
        {},
        {
          commandTimeoutMillis: 100,
          limits: { maxInFlightCommands: 2 },
        },
      );
      const request = yield* Effect.forkChild(
        Effect.flip(
          sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
        ),
      );
      const first = yield* primary.nextWrite;
      const prefix = Result.getOrThrow(encodeBatch([["INCR", "a"]], { maxQueuedBytes: 128 }));
      yield* first.accept(prefix.length);
      yield* primary.receive(bytes(":1\r\n"));
      yield* TestClock.adjust(100);

      const failure = yield* Fiber.join(request);
      if (!(failure instanceof BatchError)) return yield* Effect.die("Expected batch failure");
      expect(Redacted.value(failure.outcomes)).toMatchObject([
        { _tag: "Completed", index: 0, result: { success: 1n } },
        { _tag: "Unknown", index: 1 },
        { _tag: "Unsent", index: 2 },
      ]);
      expect(opens()).toBe(1);
      expect((yield* primary.observations).closed).toBe(1);
    }),
);
