import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";

import { Commands, makeRedisTracking, RedisKey } from "#/index";
import { layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "TRACK-LIVE: $target.fixture $protocol cache invalidation, missing keys, flush and codecs",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { config, redis, oracle, prefix, server } = yield* sessionBackend(target, protocol);
      const tracking = yield* makeRedisTracking(config).pipe(Effect.provide(layer));
      const cache = yield* tracking.cache({ maxEntries: 2, maxBytes: 512 });
      const key = `${prefix}:key`;
      yield* redis.set(key, "old");

      expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("old")));
      expect(yield* cache.snapshot).toMatchObject({ entries: 1 });
      expect(yield* tracking.trackingInfo()).toMatchObject({
        flags: expect.arrayContaining(["on"]),
      });
      yield* redis.set(key, "new");
      expect(yield* Stream.runCollect(tracking.invalidations.pipe(Stream.take(1)))).toMatchObject([
        { keys: [bytes(key)] },
      ]);
      expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
      expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("new")));

      const missing = `${prefix}:missing`;
      expect(yield* cache.getBytes(missing)).toEqual(Option.none());
      yield* redis.set(missing, "created");
      yield* Stream.runCollect(tracking.invalidations.pipe(Stream.take(1)));
      expect(yield* cache.getBytes(missing)).toEqual(Option.some(bytes("created")));

      // This fixture owns the entire disposable server; endpoint-mode tests never enter this suite.
      yield* exchange(oracle, ["FLUSHDB"]);
      expect(yield* Stream.runCollect(tracking.invalidations.pipe(Stream.take(1)))).toMatchObject([
        { keys: null },
      ]);
      expect(yield* cache.snapshot).toMatchObject({ entries: 0 });

      const typed = RedisKey.json(key, Schema.Struct({ version: Schema.Number }));
      yield* redis.setKey(typed, { version: 7 });
      expect(yield* cache.getKey(typed)).toEqual(Option.some({ version: 7 }));
      yield* tracking.execute(Commands.set(key, "self-write"));
      expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("self-write")));

      yield* recordFixture(`tracking-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: [
          "tracking-setup",
          "read-invalidation",
          "negative-cache",
          "flush",
          "schema-envelope",
          "self-write",
        ],
      });
    }),
);
