import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schema, Stream } from "effect";

import { makeRedisStreams, PayloadCodec, StreamPayload } from "#/index";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { waitForBlockedRead } from "#test/support/networking/BlockedRead";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "STREAM-RUNTIME: $target.fixture $protocol restart, claims, payloads and continuous tail",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, sessions, oracle, prefix, server } = yield* sessionBackend(target, protocol);
      const streams = makeRedisStreams(redis, sessions);
      const key = `${prefix}:stream`;
      const marker = `${prefix}:external`;
      yield* redis.xgroupCreate(key, "g", "0", { mkstream: true });
      const id = yield* redis.xadd(key, "*", [["f", "first"]]);

      // Simulate the crash window after an external effect but before acknowledgment.
      const failed = yield* Effect.flip(
        Stream.runDrain(
          streams.consume("g", "consumer", [key], () =>
            redis.incr(marker).pipe(Effect.andThen(Effect.fail("crash-before-ack"))),
          ),
        ),
      );
      expect(failed).toBe("crash-before-ack");
      expect(yield* redis.get(marker)).toEqual(Option.some("1"));
      expect((yield* redis.xpending(key, "g")).count).toBe(1n);

      const resumed = yield* Stream.runCollect(
        streams.consume("g", "consumer", [key], () => redis.incr(marker)).pipe(Stream.take(1)),
      );
      expect(resumed).toMatchObject([
        { _tag: "Processed", message: { entry: { id } }, result: 2n },
      ]);
      expect((yield* redis.xpending(key, "g")).count).toBe(0n);

      const abandoned = yield* redis.xadd(key, "*", [["f", "abandoned"]]);
      yield* redis.xreadgroup("g", "old-consumer", [[key, ">"]]);
      const pages = yield* Stream.runCollect(
        streams.claim(key, "g", "replacement", 0, { count: 1 }),
      );
      const recovered = pages.flatMap((page) =>
        page.entries.flatMap((entry) =>
          Option.isSome(entry) ? [{ stream: bytes(key), entry: entry.value }] : [],
        ),
      );
      expect(recovered.map((entry) => entry.entry.id)).toEqual([abandoned]);
      expect(
        yield* Stream.runCollect(
          streams.process("g", Stream.fromIterable(recovered), () => Effect.succeed("claimed")),
        ),
      ).toMatchObject([{ _tag: "Processed", result: "claimed" }]);
      expect((yield* redis.xpending(key, "g")).count).toBe(0n);

      const payload = StreamPayload.field(
        "body",
        PayloadCodec.json(Schema.Struct({ jobId: Schema.String })),
      );
      const payloadKey = `${prefix}:payload`;
      yield* redis.xaddPayload(payloadKey, "*", payload, { jobId: "fixture-job" });
      const entry = (yield* redis.xrange(payloadKey))[0];
      if (entry === undefined) return yield* Effect.die("Missing encoded payload entry");
      expect(yield* payload.decode(entry)).toEqual({ jobId: "fixture-job" });

      const reader = yield* Effect.forkChild(
        Stream.runCollect(streams.read([[payloadKey, "$"]]).pipe(Stream.take(1))),
      );
      yield* waitForBlockedRead(oracle, "xread");
      const next = yield* redis.xaddPayload(payloadKey, "*", payload, { jobId: "next-job" });
      const delivered = yield* Fiber.join(reader);
      expect(delivered).toMatchObject([{ entry: { id: next } }]);
      expect(yield* sessions.snapshot).toMatchObject({ leased: 0, waiting: 0 });
      yield* recordFixture(`stream-runtime-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        product: target.product,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["restart-before-ack", "abandoned-claim", "payload-envelope", "continuous-tail"],
      });
    }),
);
