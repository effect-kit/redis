import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, Redacted, Result } from "effect";

import { BatchError } from "#/errors/BatchError";
import { Commands, defineCommand } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { sessionFixture } from "#test/support/sessions/Fixture";

it.effect(
  "SESSION-PIPELINE: all frames are written before waiting for ordered heterogeneous replies",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const request = yield* Effect.forkChild(
        sessions.pipeline([Commands.get("a"), Commands.incr("b"), Commands.hget("c", "f")]),
      );
      yield* sent(primary, ["GET", "a"]);
      yield* sent(primary, ["INCR", "b"]);
      yield* sent(primary, ["HGET", "c", "f"]);
      yield* primary.receive(bytes("$1\r\nx\r\n:9007199254740993\r\n-WRONGTYPE private-value\r\n"));

      const results = yield* Fiber.join(request);
      expect(results[0]).toMatchObject({ _tag: "Success", success: { value: "x" } });
      expect(results[1]).toEqual(Result.succeed(9007199254740993n));
      expect(results[2]).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ServerError", code: "WRONGTYPE" },
      });
      expect(JSON.stringify(results[2])).not.toContain("private-value");
    }),
);

it.effect("SESSION-PIPELINE: input/mode/byte limits fail before any batch command is written", () =>
  Effect.gen(function* () {
    const { sessions, opens, primary } = yield* sessionFixture(
      { maxBatchCommands: 2 },
      { limits: { maxQueuedBytes: 128 } },
    );
    expect(
      yield* Effect.flip(
        sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
      ),
    ).toMatchObject({ reason: "batch-limit" });
    expect(yield* Effect.flip(sessions.pipeline([Commands.incrby("a", NaN)]))).toMatchObject({
      _tag: "CommandInputError",
    });
    expect(
      yield* Effect.flip(
        sessions.pipeline([
          Commands.raw(["MULTI"], { execution: "ordinary", routing: { _tag: "Keyless" } }),
        ]),
      ),
    ).toMatchObject({ reason: "execution-mode" });
    expect(opens()).toBe(0);

    const rejected = yield* Effect.flip(sessions.pipeline([Commands.set("a", "x".repeat(200))]));
    expect(rejected).toMatchObject({ _tag: "BatchError", execution: "not-executed" });
    expect(yield* primary.written).toEqual([]);
    expect(yield* sessions.pipeline([])).toEqual([]);
  }),
);

it.effect(
  "SESSION-PIPELINE: lost replies preserve completed, possibly-written and definitely-unsent slots",
  () =>
    Effect.gen(function* () {
      const { sessions, primary, opens } = yield* sessionFixture(
        {},
        { limits: { maxInFlightCommands: 1 } },
      );
      const request = yield* Effect.forkChild(
        Effect.flip(
          sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
        ),
      );
      yield* sent(primary, ["INCR", "a"], ":1\r\n");
      yield* sent(primary, ["INCR", "b"]);
      yield* primary.end;

      const failure = yield* Fiber.join(request);
      expect(failure).toMatchObject({ _tag: "BatchError", execution: "partial-or-unknown" });
      if (!(failure instanceof BatchError)) return yield* Effect.die("Missing batch evidence");
      expect(Redacted.value(failure.outcomes)).toMatchObject([
        { _tag: "Completed", index: 0, result: { success: 1n } },
        { _tag: "Unknown", index: 1 },
        { _tag: "Unsent", index: 2 },
      ]);
      expect(opens()).toBe(1);
    }),
);

it.effect("SESSION-PIPELINE: interruption retains its Cause and raw received-slot evidence", () =>
  Effect.gen(function* () {
    const { sessions, primary } = yield* sessionFixture({}, { limits: { maxInFlightCommands: 1 } });
    const request = yield* Effect.forkChild(
      sessions.pipeline([Commands.incr("a"), Commands.incr("b"), Commands.incr("c")]),
    );
    yield* sent(primary, ["INCR", "a"], ":1\r\n");
    yield* sent(primary, ["INCR", "b"]);
    yield* Fiber.interrupt(request);
    const exit = yield* Fiber.await(request);
    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") return yield* Effect.die("Expected interruption");
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    const failure = Cause.findError(exit.cause);
    expect(failure).toMatchObject({ success: { _tag: "BatchError" } });
    if (failure._tag !== "Success" || !(failure.success instanceof BatchError))
      return yield* Effect.die("Missing batch evidence");
    expect(Redacted.value(failure.success.outcomes)).toMatchObject([
      { _tag: "Replied", index: 0 },
      { _tag: "Unknown", index: 1 },
      { _tag: "Unsent", index: 2 },
    ]);
  }),
);

it.effect(
  "SESSION-PIPELINE: interrupted codec work retains earlier decoded and remaining received results",
  () =>
    Effect.gen(function* () {
      const { sessions, primary } = yield* sessionFixture();
      const decoding = yield* Deferred.make<void>();
      const original = yield* Commands.incr("b").prepare;
      const delayed = defineCommand({
        ...original,
        decode: () => Deferred.succeed(decoding, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const request = yield* Effect.forkChild(sessions.pipeline([Commands.incr("a"), delayed]));
      yield* sent(primary, ["INCR", "a"], ":1\r\n");
      yield* sent(primary, ["INCR", "b"], ":2\r\n");
      yield* Deferred.await(decoding);
      yield* Fiber.interrupt(request);
      const exit = yield* Fiber.await(request);
      if (exit._tag !== "Failure") return yield* Effect.die("Expected interruption");
      const failure = Cause.findError(exit.cause);
      if (failure._tag !== "Success" || !(failure.success instanceof BatchError))
        return yield* Effect.die("Missing batch evidence");
      expect(failure.success.execution).toBe("replied");
      expect(Redacted.value(failure.success.outcomes)).toMatchObject([
        { _tag: "Completed", index: 0, result: { success: 1n } },
        { _tag: "Replied", index: 1 },
      ]);
    }),
);
