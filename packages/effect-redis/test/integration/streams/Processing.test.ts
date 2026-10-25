import { expect, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";

import type { GroupMessage } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { groupReply, streamFixture } from "#test/support/streams/Fixture";

const message = (id: "1-0" | "2-0" = "1-0"): GroupMessage => ({
  stream: bytes("s"),
  entry: { id, fields: Option.some([[bytes("f"), bytes("v")]]) },
});

it.effect("STREAM-PROCESS: acknowledgment waits for successful application processing", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    const entered = yield* Deferred.make<void>();
    const finished = yield* Deferred.make<void>();
    const request = yield* Effect.forkChild(
      Stream.runCollect(
        streams.process("g", Stream.make(message()), () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(finished)),
            Effect.as("result"),
          ),
        ),
      ),
    );
    yield* Deferred.await(entered);
    expect(yield* ordinary.written).toEqual([]);
    yield* Deferred.succeed(finished, undefined);
    yield* sent(ordinary, ["XACK", "s", "g", "1-0"], ":1\r\n");
    expect(yield* Fiber.join(request)).toMatchObject([{ _tag: "Processed", result: "result" }]);
  }),
);

it.effect(
  "STREAM-PROCESS: bounded application retries use TestClock and acknowledge only success",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary } = yield* streamFixture();
      const attempts = yield* Ref.make(0);
      const failed = yield* Deferred.make<void>();
      const request = yield* Effect.forkChild(
        Stream.runCollect(
          streams.process(
            "g",
            Stream.make(message()),
            () =>
              Ref.updateAndGet(attempts, (n) => n + 1).pipe(
                Effect.flatMap((n) => (n === 1 ? Effect.fail("retry-me") : Effect.succeed(n))),
              ),
            {
              maxAttempts: 2,
              onFailure: () =>
                Deferred.succeed(failed, undefined).pipe(
                  Effect.as({ _tag: "Retry", delay: Duration.millis(10) } as const),
                ),
            },
          ),
        ),
      );
      yield* Deferred.await(failed);
      expect(yield* ordinary.written).toEqual([]);
      yield* TestClock.adjust(10);
      yield* sent(ordinary, ["XACK", "s", "g", "1-0"], ":1\r\n");
      expect(yield* Fiber.join(request)).toMatchObject([{ _tag: "Processed", result: 2 }]);
      expect(yield* Ref.get(attempts)).toBe(2);
    }),
);

it.effect(
  "STREAM-PROCESS: a failure can explicitly remain pending without hiding its outcome",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary } = yield* streamFixture();
      const result = yield* Stream.runCollect(
        streams.process("g", Stream.make(message()), () => Effect.fail("synthetic-failure"), {
          onFailure: () => Effect.succeed({ _tag: "LeavePending" }),
        }),
      );
      expect(result).toMatchObject([{ _tag: "Pending" }]);
      expect(JSON.stringify(result)).not.toContain("synthetic-failure");
      expect(yield* ordinary.written).toEqual([]);
    }),
);

it.effect("STREAM-PROCESS: dead-letter failure cannot acknowledge the original entry", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    const failure = yield* Effect.flip(
      Stream.runCollect(
        streams.process("g", Stream.make(message()), () => Effect.fail("application"), {
          onFailure: () => Effect.fail("dead-letter-failed"),
        }),
      ),
    );
    expect(failure).toBe("dead-letter-failed");
    expect(yield* ordinary.written).toEqual([]);
  }),
);

it.effect("STREAM-PROCESS: tombstones require an explicit acknowledgment policy", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    const tombstone: GroupMessage = { ...message(), entry: { id: "1-0", fields: Option.none() } };
    let calls = 0;
    const handle = () =>
      Effect.sync(() => {
        calls++;
      });
    expect(
      yield* Effect.flip(Stream.runCollect(streams.process("g", Stream.make(tombstone), handle))),
    ).toMatchObject({ reason: "tombstone" });
    expect(calls).toBe(0);
    expect(yield* ordinary.written).toEqual([]);
    const request = yield* Effect.forkChild(
      Stream.runCollect(
        streams.process("g", Stream.make(tombstone), handle, {
          onFailure: () => Effect.succeed({ _tag: "Acknowledge" }),
        }),
      ),
    );
    yield* sent(ordinary, ["XACK", "s", "g", "1-0"], ":1\r\n");
    expect(yield* Fiber.join(request)).toMatchObject([{ _tag: "Handled" }]);
    expect(calls).toBe(0);
  }),
);

it.effect(
  "STREAM-PROCESS: lost acknowledgment does not retry the successful application effect",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary } = yield* streamFixture();
      let calls = 0;
      const request = yield* Effect.forkChild(
        Effect.flip(
          Stream.runCollect(
            streams.process("g", Stream.make(message()), () => Effect.sync(() => ++calls), {
              maxAttempts: 3,
            }),
          ),
        ),
      );
      yield* sent(ordinary, ["XACK", "s", "g", "1-0"]);
      yield* ordinary.end;
      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(calls).toBe(1);
    }),
);

it.effect("STREAM-CONSUME: pending processing finishes before new group deliveries begin", () =>
  Effect.gen(function* () {
    const { streams, ordinary, blocking } = yield* streamFixture();
    const request = yield* Effect.forkChild(
      Stream.runCollect(
        streams
          .consume("g", "c", ["s"], (entry) => Effect.succeed(entry.entry.id))
          .pipe(Stream.take(2)),
      ),
    );
    yield* sent(
      ordinary,
      ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "STREAMS", "s", "0-0"],
      groupReply("1-0"),
    );
    yield* sent(ordinary, ["XACK", "s", "g", "1-0"], ":1\r\n");
    yield* sent(
      ordinary,
      ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "STREAMS", "s", "1-0"],
      "*-1\r\n",
    );
    yield* sent(
      blocking,
      ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "BLOCK", "5000", "STREAMS", "s", ">"],
      groupReply("2-0"),
    );
    yield* sent(ordinary, ["XACK", "s", "g", "2-0"], ":1\r\n");
    expect(yield* Fiber.join(request)).toMatchObject([{ result: "1-0" }, { result: "2-0" }]);
  }),
);

it.effect(
  "STREAM-CONSUME: invalid reader policy fails before pending work can be acknowledged",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary, opens } = yield* streamFixture();
      expect(
        yield* Effect.flip(
          Stream.runDrain(streams.consume("g", "c", ["s"], () => Effect.void, {}, { count: 0 })),
        ),
      ).toMatchObject({ _tag: "CommandInputError" });
      expect(yield* ordinary.written).toEqual([]);
      expect(opens()).toBe(1);
    }),
);
