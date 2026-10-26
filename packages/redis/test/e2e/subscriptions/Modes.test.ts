import { expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";

import { Commands, makeRedisTracking } from "#/index";
import { layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "TRACK-MODES: $target.fixture $protocol opt-in/out, broadcast, redirection and exclusive controls",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { config, redis, sessions, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:key`;
      const binaryKey = new Uint8Array([...bytes(prefix), 0, 255]);
      yield* redis.set(key, "v");

      for (const mode of ["optin", "optout"] as const) {
        const tracking = yield* makeRedisTracking(config, {
          tracking: { mode, noLoop: true },
          delivery: "redirect",
        }).pipe(Effect.provide(layer));
        const cache = yield* tracking.cache();
        expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("v")));
        expect((yield* tracking.trackingInfo()).flags).toContain(mode);
        yield* tracking.execute(Commands.set(key, "self"));
        expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
        expect(yield* cache.getBytes(key)).toEqual(Option.some(bytes("self")));
        yield* redis.set(key, "v");
        yield* Stream.runCollect(tracking.invalidations.pipe(Stream.take(1)));
        expect(yield* cache.snapshot).toMatchObject({ entries: 0 });
      }

      const broadcast = yield* makeRedisTracking(config, {
        tracking: { mode: "broadcast", prefixes: [bytes(prefix)] },
      }).pipe(Effect.provide(layer));
      const cache = yield* broadcast.cache();
      yield* redis.set(binaryKey, new Uint8Array([255]));
      expect(yield* cache.getBytes(binaryKey)).toEqual(Option.some(new Uint8Array([255])));
      yield* redis.set(binaryKey, new Uint8Array([128]));
      yield* Stream.runCollect(broadcast.invalidations.pipe(Stream.take(1)));
      expect(yield* cache.getBytes(binaryKey)).toEqual(Option.some(new Uint8Array([128])));
      yield* cache.getBytes("outside-tracked-prefix");
      expect(yield* cache.snapshot).toMatchObject({ entries: 1 });

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          yield* session.tracking(true, { mode: "optin" });
          expect((yield* session.trackingInfo()).flags).toContain("optin");
          expect(yield* session.caching("YES", Commands.getBytes(key))).toEqual(
            Option.some(bytes("v")),
          );
          yield* session.tracking(false);
          expect((yield* session.trackingInfo()).flags).toEqual(["off"]);
        }),
      );
    }),
);
