import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";

import { makeExecutor } from "#/command/Executor";
import { BatchError } from "#/errors/BatchError";
import { TransportError } from "#/errors/TransportError";
import { Commands, fromPreparation } from "#/index";
import { makeRedis } from "#/Redis";
import { controlled, sent, waitForSnapshot } from "#test/support/connection/Controlled";

it.effect(
  "ordinary batches and commands share one connection without leasing or awaiting earlier replies",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const redis = makeRedis(makeExecutor(connection));
      const batch = yield* Effect.forkChild(redis.batch([Commands.get("a"), Commands.incr("b")]));
      yield* sent(fixture, ["GET", "a"]);
      yield* sent(fixture, ["INCR", "b"]);
      const ordinary = yield* Effect.forkChild(redis.get("c"));
      yield* sent(fixture, ["GET", "c"], "$1\r\nx\r\n:9007199254740993\r\n$1\r\ny\r\n");
      expect(yield* Fiber.join(batch)).toEqual([Option.some("x"), 9007199254740993n]);
      expect(yield* Fiber.join(ordinary)).toEqual(Option.some("y"));
      expect(yield* connection.snapshot).toMatchObject({
        connectionAttempts: 1,
        inFlightCommands: 0,
      });
    }),
);

it.effect(
  "values batches drain all slots and report exact indexed decoder and server failures",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const redis = makeRedis(makeExecutor(connection));
      const batch = yield* Effect.forkChild(
        Effect.flip(redis.batch([Commands.get("a"), Commands.incr("b"), Commands.get("c")])),
      );
      yield* sent(fixture, ["GET", "a"]);
      yield* sent(fixture, ["INCR", "b"]);
      yield* sent(fixture, ["GET", "c"], "$1\r\nx\r\n-WRONGTYPE private-value\r\n:1\r\n");
      const failure = yield* Fiber.join(batch);
      if (failure._tag !== "BatchError") return yield* Effect.die(failure);
      const outcomes = Redacted.value(failure.outcomes);
      expect(failure.execution).toBe("replied");
      expect(outcomes).toMatchObject([
        { _tag: "Completed", index: 0, result: { _tag: "Success", success: Option.some("x") } },
        {
          _tag: "Completed",
          index: 1,
          result: { _tag: "Failure", failure: { _tag: "ServerError", code: "WRONGTYPE" } },
        },
        {
          _tag: "Completed",
          index: 2,
          result: { _tag: "Failure", failure: { _tag: "ReplyError" } },
        },
      ]);
      expect(JSON.stringify(failure)).not.toContain("private-value");
      const next = yield* Effect.forkChild(redis.ping());
      yield* sent(fixture, ["PING"], "+PONG\r\n");
      expect(yield* Fiber.join(next)).toBeUndefined();
    }),
);

it.effect("all commands prepare and fit admission before any batch byte is written", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({ limits: { maxQueuedCommands: 1 } });
    const redis = makeRedis(makeExecutor(connection));
    const failure = yield* Effect.flip(redis.batch([Commands.get("a"), Commands.get("b")]));
    expect(failure).toMatchObject({ _tag: "BatchError", execution: "not-executed" });
    expect(yield* fixture.written).toEqual([]);
    expect(yield* connection.snapshot).toMatchObject({ queuedCommands: 0, connectionAttempts: 1 });
    expect(
      yield* Effect.flip(redis.batch([Commands.get("a"), Commands.incrby("b", NaN)])),
    ).toMatchObject({ _tag: "CommandInputError" });
    expect(yield* redis.batch([])).toEqual([]);
  }),
);

it.effect(
  "a timed out written batch retires its shared generation and classifies unsent suffixes",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({
        commandTimeoutMillis: 10,
        limits: { maxInFlightCommands: 1 },
      });
      const redis = makeRedis(makeExecutor(connection));
      const batch = yield* Effect.forkChild(
        Effect.flip(redis.batch([Commands.get("a"), Commands.get("b")])),
      );
      yield* sent(fixture, ["GET", "a"]);
      yield* TestClock.adjust(11);
      const failure = yield* Fiber.join(batch);
      if (failure._tag !== "BatchError") return yield* Effect.die(failure);
      expect(Redacted.value(failure.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
        { _tag: "Unsent", index: 1 },
      ]);
      expect(yield* connection.snapshot).toMatchObject({
        queuedCommands: 0,
        inFlightCommands: 0,
        retiredGenerations: 1,
      });
    }),
);

it.effect(
  "interrupting a possibly written batch preserves the Cause and retires other shared work",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const redis = makeRedis(makeExecutor(connection));
      const ordinary = yield* Effect.forkChild(Effect.exit(redis.get("other")));
      yield* sent(fixture, ["GET", "other"]);
      const batch = yield* Effect.forkChild(redis.batch([Commands.get("a"), Commands.get("b")]));
      yield* sent(fixture, ["GET", "a"]);
      yield* sent(fixture, ["GET", "b"]);
      yield* Fiber.interrupt(batch);
      const exit = yield* Fiber.await(batch);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      if (Exit.isFailure(exit))
        expect(
          exit.cause.reasons.some(
            (reason) =>
              Cause.isFailReason(reason) &&
              reason.error instanceof Object &&
              "_tag" in reason.error &&
              reason.error._tag === "BatchError",
          ),
        ).toBe(true);
      expect(yield* Fiber.join(ordinary)).toMatchObject({ _tag: "Failure" });
      yield* waitForSnapshot(connection, (snapshot) => snapshot.inFlightCommands === 0);
    }),
);

it.effect("decoder defects retain completed slots and received but undecoded replies", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const redis = makeRedis(makeExecutor(connection));
    const failure = new Error("decoder defect");
    const defect = fromPreparation(
      Commands.get("b").prepare.pipe(
        Effect.map((prepared) => ({ ...prepared, decode: () => Effect.die(failure) })),
      ),
    );
    const batch = yield* Effect.forkChild(
      Effect.exit(redis.batch([Commands.incr("a"), defect, Commands.get("c")])),
    );
    yield* sent(fixture, ["INCR", "a"]);
    yield* sent(fixture, ["GET", "b"]);
    yield* sent(fixture, ["GET", "c"], ":1\r\n$1\r\nx\r\n$1\r\ny\r\n");
    const exit = yield* Fiber.join(batch);
    if (Exit.isSuccess(exit)) return yield* Effect.die("Expected decoder defect");
    expect(Cause.hasDies(exit.cause)).toBe(true);
    // Effect elects typed finalizer evidence to defects alongside a decoder defect.
    const evidence = exit.cause.reasons
      .filter(Cause.isDieReason)
      .map((reason) => reason.defect)
      .find((cause) => cause instanceof BatchError);
    if (!(evidence instanceof BatchError)) return yield* Effect.die("Missing batch evidence");
    const error = evidence;
    expect(Redacted.value(error.outcomes)).toMatchObject([
      { _tag: "Completed", index: 0, result: Result.succeed(1n) },
      { _tag: "Replied", index: 1 },
      { _tag: "Replied", index: 2 },
    ]);
  }),
);

it.effect(
  "a lost connection preserves completed replies and never replays unknown batch commands",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({ limits: { maxInFlightCommands: 2 } });
      const redis = makeRedis(makeExecutor(connection));
      const batch = yield* Effect.forkChild(
        Effect.flip(
          redis.batch([
            Commands.incr("a"),
            Commands.incr("b"),
            Commands.incr("c"),
            Commands.incr("d"),
          ]),
        ),
      );
      yield* sent(fixture, ["INCR", "a"]);
      yield* sent(fixture, ["INCR", "b"], ":1\r\n");
      yield* sent(fixture, ["INCR", "c"]);
      yield* fixture.failRead(new TransportError({ stage: "read", reason: "closed" }));
      const failure = yield* Fiber.join(batch);
      if (failure._tag !== "BatchError") return yield* Effect.die(failure);
      expect(Redacted.value(failure.outcomes)).toMatchObject([
        { _tag: "Completed", index: 0, result: Result.succeed(1n) },
        { _tag: "Unknown", index: 1 },
        { _tag: "Unknown", index: 2 },
        { _tag: "Unsent", index: 3 },
      ]);
      expect(yield* connection.snapshot).toMatchObject({
        connectionAttempts: 1,
        queuedCommands: 0,
        inFlightCommands: 0,
      });
    }),
);
