import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Stream } from "effect";

import { makeRedisSessions, makeRedisStreams } from "#/index";
import type { GroupMessage } from "#/index";
import { Transport } from "#/transport/Transport";
import { bytes, sent } from "#test/support/connection/Controlled";
import { groupReply, streamFixture } from "#test/support/streams/Fixture";

const messages: ReadonlyArray<GroupMessage> = ["1-0", "2-0", "3-0"].map((id) => ({
  stream: bytes("s"),
  entry: { id: id as `${bigint}-${bigint}`, fields: Option.some([[bytes("f"), bytes("v")]]) },
}));

it.effect(
  "STREAM-CONCURRENCY: processing pressure is bounded and all acknowledgments remain owned",
  () =>
    Effect.gen(function* () {
      const { streams, ordinary } = yield* streamFixture();
      const gate = yield* Deferred.make<void>();
      const active = yield* Ref.make(0);
      const maximum = yield* Ref.make(0);
      const entered = yield* Ref.make(0);
      const request = yield* Effect.forkChild(
        Stream.runCollect(
          streams.process(
            "g",
            Stream.fromIterable(messages),
            () =>
              Effect.gen(function* () {
                const count = yield* Ref.updateAndGet(active, (n) => n + 1);
                yield* Ref.update(maximum, (n) => Math.max(n, count));
                yield* Ref.update(entered, (n) => n + 1);
                yield* Deferred.await(gate);
                yield* Ref.update(active, (n) => n - 1);
              }),
            { concurrency: 2 },
          ),
        ),
      );
      while ((yield* Ref.get(entered)) !== 2) yield* Effect.yieldNow;
      expect(yield* ordinary.written).toEqual([]);
      yield* Deferred.succeed(gate, undefined);
      const acknowledged: string[] = [];
      for (let index = 0; index < 3; index++) {
        const write = yield* ordinary.nextWrite;
        const wire = new TextDecoder().decode(write.bytes);
        expect(wire).toContain("XACK");
        const id = ["1-0", "2-0", "3-0"].find((candidate) => wire.includes(candidate));
        if (id === undefined) return yield* Effect.die("Missing acknowledgment ID");
        acknowledged.push(id);
        yield* write.accept(write.bytes.length);
        yield* ordinary.receive(bytes(":1\r\n"));
      }
      expect(yield* Fiber.join(request)).toHaveLength(3);
      expect(acknowledged.toSorted()).toEqual(["1-0", "2-0", "3-0"]);
      expect(yield* Ref.get(maximum)).toBe(2);
    }),
);

it.effect("STREAM-CANCEL: interruption during processing leaves the entry unacknowledged", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    const started = yield* Deferred.make<void>();
    const request = yield* Effect.forkChild(
      Stream.runDrain(
        streams.process("g", Stream.fromIterable(messages), () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(request);
    expect(yield* ordinary.written).toEqual([]);
  }),
);

it.effect("STREAM-DEFECT: application defects bypass failure policies and cannot acknowledge", () =>
  Effect.gen(function* () {
    const { streams, ordinary } = yield* streamFixture();
    let policies = 0;
    const exit = yield* Effect.exit(
      Stream.runDrain(
        streams.process(
          "g",
          Stream.fromIterable(messages),
          () => Effect.die("synthetic-application-defect"),
          {
            onFailure: () =>
              Effect.sync(() => {
                policies++;
                return { _tag: "Acknowledge" } as const;
              }),
          },
        ),
      ),
    );
    expect(Exit.hasDies(exit)).toBe(true);
    expect(policies).toBe(0);
    expect(yield* ordinary.written).toEqual([]);
  }),
);

it.effect(
  "STREAM-CLEANUP: physical cleanup defects escape reader termination and poison the pool",
  () =>
    Effect.gen(function* () {
      const fixture = yield* streamFixture();
      const native = yield* Transport.pipe(Effect.provide(fixture.layer));
      const sessions = yield* makeRedisSessions(fixture.config).pipe(
        Effect.provideService(Transport, {
          open: (config) =>
            native
              .open(config)
              .pipe(
                Effect.tap(() => Effect.addFinalizer(() => Effect.die("synthetic-reader-cleanup"))),
              ),
        }),
      );
      const streams = makeRedisStreams(fixture.redis, sessions);
      const request = yield* Effect.forkChild(
        Effect.exit(Stream.runCollect(streams.readGroup("g", "c", ["s"]).pipe(Stream.take(1)))),
      );
      yield* sent(
        fixture.blocking,
        ["XREADGROUP", "GROUP", "g", "c", "COUNT", "64", "BLOCK", "5000", "STREAMS", "s", ">"],
        groupReply(),
      );
      const exit = yield* Fiber.join(request);
      expect(Exit.hasDies(exit)).toBe(true);
      if (exit._tag !== "Failure") return yield* Effect.die("Expected cleanup defect");
      expect(Cause.findDefect(exit.cause)).toMatchObject({ success: "synthetic-reader-cleanup" });
      expect(
        Exit.hasDies(yield* Effect.exit(sessions.withSession((session) => session.ping()))),
      ).toBe(true);
      expect(fixture.opens()).toBe(2);
    }),
);
