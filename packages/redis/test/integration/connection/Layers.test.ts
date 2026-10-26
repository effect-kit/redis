import { expect, it } from "@effect/vitest";
import { Config, Effect, Fiber, Redacted, Result } from "effect";

import { RedisAdmin } from "#/admin/RedisAdmin";
import { nativeLayers } from "#/client/Native";
import { Commands, Redis, RedisScripts, RedisSessions, RedisStreams } from "#/index";
import { cryptoLayer } from "#/platform/node/Crypto";
import { reconnecting, sent } from "#test/support/connection/Controlled";

it.effect(
  "ready native Layer shares one ordinary connection and one lazy session pool across helpers",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      const [ordinary, session] = fixture.fixtures;
      if (ordinary === undefined || session === undefined)
        return yield* Effect.die("Missing fixture");
      const live = nativeLayers(fixture.layer, cryptoLayer).layer({
        url: "redis://localhost:6379",
        protocol: "resp2",
      });
      const running = yield* Effect.gen(function* () {
        const redis = yield* Redis;
        const sessions = yield* RedisSessions;
        yield* RedisStreams;
        yield* RedisScripts;
        yield* RedisAdmin;
        expect(fixture.opens()).toBe(1);

        yield* redis.ping();
        const results = yield* redis.pipeline([Commands.ping(), Commands.incr("counter")]);
        expect(Result.getOrThrow(results[1])).toBe(1n);
        yield* sessions.withSession((client) => client.ping());
        expect(fixture.opens()).toBe(2);
      }).pipe(Effect.provide(live), Effect.forkChild);

      yield* sent(ordinary, ["PING"], "+PONG\r\n");
      yield* sent(session, ["PING"], "+PONG\r\n");
      yield* sent(session, ["INCR", "counter"], ":1\r\n");
      yield* sent(session, ["PING"], "+PONG\r\n");
      yield* Fiber.join(running);
      expect((yield* ordinary.observations).closed).toBe(1);
      expect((yield* session.observations).closed).toBe(1);
    }),
);

it.effect("layerConfig validates inside scope and supplies fixed redacted authentication", () =>
  Effect.gen(function* () {
    const fixture = yield* reconnecting();
    const first = fixture.fixtures[0];
    if (first === undefined) return yield* Effect.die("Missing fixture");
    const live = nativeLayers(fixture.layer, cryptoLayer).layerConfig(
      Config.succeed({
        url: "redis://localhost",
        protocol: "resp2" as const,
        credentials: { password: Redacted.make("fixture-secret") },
      }),
    );
    const running = yield* Redis.pipe(
      Effect.flatMap((redis) => redis.ping()),
      Effect.provide(live),
      Effect.forkChild,
    );

    yield* sent(first, ["AUTH", "fixture-secret"], "+OK\r\n");
    yield* sent(first, ["PING"], "+PONG\r\n");
    yield* Fiber.join(running);
  }),
);

it.effect(
  "invalid native preset input fails before opening a socket and redacts its credentials",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      const layers = nativeLayers(fixture.layer, cryptoLayer);
      const live = layers.layer({
        url: "redis://fixture-user:fixture-secret@localhost",
        credentials: Effect.succeed({ password: Redacted.make("other-secret") }),
      });

      const error = yield* Effect.flip(Redis.pipe(Effect.provide(live)));
      expect(error).toMatchObject({ _tag: "RedisConfigError", field: "credentials" });
      expect(JSON.stringify(error)).not.toContain("fixture-secret");
      expect(JSON.stringify(error)).not.toContain("other-secret");
      expect(fixture.opens()).toBe(0);
    }),
);
