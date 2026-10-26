import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { makeRedisSessions, makeRedisStreams, decodeRedisConfig } from "#/index";
import { layer } from "#/node";
import { Transport } from "#/transport/Transport";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import { sessionBackend } from "#test/support/sessions/Backend";

const targets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

it.live.each(targets)(
  "STREAM-LOSS: $fixture lost group delivery remains pending without replay",
  (target) =>
    Effect.gen(function* () {
      const { redis, prefix, server } = yield* sessionBackend(target, "resp2");
      const key = `${prefix}:stream`;
      yield* redis.xgroupCreate(key, "g", "0", { mkstream: true });
      const id = yield* redis.xadd(key, "*", [["f", "v"]]);
      const proxy = yield* faultProxy(server.port, { holdReplies: true, fragmentBytes: 1 });
      const native = yield* Transport.pipe(Effect.provide(layer));
      let opens = 0;
      const sessions = yield* makeRedisSessions(
        yield* decodeRedisConfig({
          endpoint: { host: "127.0.0.1", port: proxy.port },
          protocol: "resp2",
        }),
      ).pipe(
        Effect.provideService(Transport, {
          open: (config) =>
            Effect.sync(() => {
              opens++;
            }).pipe(Effect.andThen(native.open(config))),
        }),
      );
      const streams = makeRedisStreams(redis, sessions);
      const request = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(streams.readGroup("g", "c", [key]))),
      );
      yield* proxy.firstReply;
      expect((yield* redis.xpending(key, "g")).count).toBe(1n);
      yield* proxy.cut;
      expect(yield* Fiber.join(request)).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      expect(opens).toBe(1);
      expect(
        (yield* redis.xpendingEntries(key, "g", { start: "-", end: "+", count: 1 }))[0],
      ).toMatchObject({ id, deliveries: 1n });
      expect(yield* Stream.runCollect(streams.pending(key, "g", "c"))).toMatchObject([
        { entry: { id } },
      ]);
      expect((yield* redis.xpending(key, "g")).count).toBe(1n);
      expect(yield* redis.xack(key, "g", [id])).toBe(1n);
    }),
);
