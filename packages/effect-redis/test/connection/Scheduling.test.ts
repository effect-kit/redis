import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import { controlled, bytes, sent, waitForSnapshot } from "../support/connection/Controlled.js";

it.effect(
  "OWNERSHIP-01: concurrent requests receive their own ordered replies and server errors",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const a = yield* Effect.forkChild(connection.executeOrdinary(["GET", "a"]));
      yield* sent(fixture, ["GET", "a"]);
      const b = yield* Effect.forkChild(connection.executeOrdinary(["GET", "b"]));
      yield* sent(fixture, ["GET", "b"]);
      yield* fixture.receive(bytes("-WRONGTYPE synthetic\r\n$1\r\nb\r\n"));
      expect(yield* Fiber.join(a)).toEqual({
        _tag: "SimpleError",
        value: bytes("WRONGTYPE synthetic"),
      });
      expect(yield* Fiber.join(b)).toEqual({ _tag: "BlobString", value: bytes("b") });
      expect(yield* connection.snapshot).toMatchObject({
        queuedCommands: 0,
        inFlightCommands: 0,
        replies: 2,
      });
    }),
);

it.effect(
  "ADMISSION-01: in-flight capacity queues fairly; canceled unsent work cannot be written",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({
        limits: { maxInFlightCommands: 1, maxQueuedCommands: 2 },
      });
      const a = yield* Effect.forkChild(connection.executeOrdinary(["GET", "a"]));
      yield* sent(fixture, ["GET", "a"]);
      const b = yield* Effect.forkChild(connection.executeOrdinary(["GET", "b"]));
      const c = yield* Effect.forkChild(connection.executeOrdinary(["GET", "c"]));
      yield* Effect.yieldNow;
      expect(yield* connection.snapshot).toMatchObject({ queuedCommands: 2, inFlightCommands: 1 });
      const excess = yield* Effect.result(connection.executeOrdinary(["GET", "d"]));
      expect(Result.isFailure(excess) && excess.failure._tag).toBe("AdmissionError");
      yield* Fiber.interrupt(b);
      yield* fixture.receive(bytes("$1\r\na\r\n"));
      yield* Fiber.join(a);
      yield* sent(fixture, ["GET", "c"], "$1\r\nc\r\n");
      expect(yield* Fiber.join(c)).toEqual({ _tag: "BlobString", value: bytes("c") });
      expect(yield* connection.snapshot).toMatchObject({
        queuedCommands: 0,
        queuedBytes: 0,
        inFlightCommands: 0,
        inFlightBytes: 0,
      });
    }),
);

it.effect(
  "UNKNOWN-01: cancel after possible write retires siblings with correct delivery evidence",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({ limits: { maxInFlightCommands: 1 } });
      const a = yield* Effect.forkChild(connection.executeOrdinary(["INCR", "counter"]));
      const attempt = yield* fixture.nextWrite;
      yield* attempt.accept(1);
      const b = yield* Effect.forkChild(
        Effect.result(connection.executeOrdinary(["GET", "queued"])),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(a);
      const outcome = yield* Fiber.join(b);
      expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
        _tag: "ConnectionError",
        delivery: "unsent",
        generation: 1,
      });
      expect((yield* fixture.observations).acceptedBytes).toBe(1);
      expect(yield* connection.snapshot).toMatchObject({
        queuedCommands: 0,
        inFlightCommands: 0,
        unknownOutcomes: 1,
      });
    }),
);

it.effect("ADMISSION-02: a queued deadline remains definitely unsent and releases its budget", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({
      commandTimeoutMillis: 100,
      limits: { maxInFlightCommands: 1 },
    });
    const a = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["GET", "a"])));
    yield* sent(fixture, ["GET", "a"]);
    const b = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["GET", "b"])));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(100);
    const first = yield* Fiber.join(a);
    const second = yield* Fiber.join(b);
    expect(Result.isFailure(first) && first.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "possibly-written",
    });
    expect(Result.isFailure(second) && second.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "unsent",
    });
    expect(yield* connection.snapshot).toMatchObject({ queuedBytes: 0, inFlightBytes: 0 });
  }),
);

it.effect("ADMISSION-03: impossible in-flight size and stateful commands fail before write", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({ limits: { maxInFlightBytes: 32 } });
    for (const command of [
      ["ECHO", "a".repeat(100)],
      ["MULTI"],
      ["CLIENT", "REPLY", "OFF"],
      ["BLPOP", "key", "0"],
    ] as const) {
      const result = yield* Effect.result(connection.executeOrdinary(command));
      expect(Result.isFailure(result) && result.failure._tag).toBe("AdmissionError");
    }
    expect((yield* fixture.observations).acceptedBytes).toBe(0);
  }),
);

it.effect("ADMISSION-04: byte capacity and FIFO survive canceled waiters", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({
      limits: { maxInFlightBytes: 32, maxQueuedBytes: 60 },
    });
    const a = yield* Effect.forkChild(connection.executeOrdinary(["GET", "a"]));
    yield* sent(fixture, ["GET", "a"]);
    const b = yield* Effect.forkChild(connection.executeOrdinary(["GET", "b"]));
    const c = yield* Effect.forkChild(connection.executeOrdinary(["GET", "c"]));
    const d = yield* Effect.forkChild(connection.executeOrdinary(["GET", "d"]));
    yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 3);
    const full = yield* Effect.result(connection.executeOrdinary(["GET", "e"]));
    expect(Result.isFailure(full) && full.failure).toMatchObject({
      _tag: "AdmissionError",
      reason: "bytes",
    });
    yield* Fiber.interrupt(c);
    yield* TestClock.adjust(50);
    yield* fixture.receive(bytes("+a\r\n"));
    yield* Fiber.join(a);
    yield* sent(fixture, ["GET", "b"], "+b\r\n");
    yield* Fiber.join(b);
    yield* sent(fixture, ["GET", "d"], "+d\r\n");
    yield* Fiber.join(d);
    expect(yield* connection.snapshot).toMatchObject({ queuedBytes: 0, inFlightBytes: 0 });
    expect((yield* connection.snapshot).queueWaitMillis).toBeGreaterThanOrEqual(100);
  }),
);

it.effect("ADMISSION-05: stream option scanning never mistakes group names or keys for BLOCK", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    for (const command of [
      ["XREAD", "STREAMS", "BLOCK", "0"],
      ["XREADGROUP", "GROUP", "BLOCK", "consumer", "COUNT", "1", "STREAMS", "BLOCK", ">"],
    ] as const) {
      const request = yield* Effect.forkChild(connection.executeOrdinary(command));
      yield* sent(fixture, command, "*-1\r\n");
      expect((yield* Fiber.join(request))._tag).toBe("Null");
    }
    const blocked = yield* Effect.result(
      connection.executeOrdinary([
        "XREADGROUP",
        "GROUP",
        "g",
        "c",
        "BLOCK",
        "1",
        "STREAMS",
        "k",
        ">",
      ]),
    );
    expect(Result.isFailure(blocked) && blocked.failure).toMatchObject({
      _tag: "AdmissionError",
      reason: "session-required",
    });
  }),
);

it.effect(
  "OWNERSHIP-10: input bytes are snapshotted and unknown ordinary commands remain usable",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const payload = new Uint8Array([0, 255, 128]);
      const request = yield* Effect.forkChild(connection.executeOrdinary(["CUSTOM.CMD", payload]));
      const attempt = yield* fixture.nextWrite;
      const expected = attempt.bytes.slice();
      payload.fill(7);
      yield* attempt.accept(attempt.bytes.length);
      yield* fixture.receive(bytes("-ERR custom-fixture-rejection\r\n"));
      expect((yield* Fiber.join(request))._tag).toBe("SimpleError");
      expect((yield* fixture.written)[0]).toEqual(expected);
      const next = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(fixture, ["PING"], "+PONG\r\n");
      yield* Fiber.join(next);
      expect((yield* connection.snapshot).generation).toBe(1);
    }),
);
