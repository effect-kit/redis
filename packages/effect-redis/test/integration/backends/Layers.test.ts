import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Config, Effect, Option, Result } from "effect";

import { Commands, Redis, RedisSessions } from "#/index";
import { RedisNode } from "#/node";
import { dockerServer } from "#test/support/servers/DockerServer";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";

const targets = serverTargets.filter(
  (target) =>
    target.fixture === target.product &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

it.live.each(targets)(
  "PRESET: $fixture one Node Layer supplies ordinary commands and leased batches",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const prefix = `preset:${randomUUID()}`;
      const live = RedisNode.layerConfig(
        Config.succeed({
          url: `redis://127.0.0.1:${server.port}`,
          protocol: "resp2" as const,
        }),
      );

      yield* Effect.gen(function* () {
        const redis = yield* Redis;
        const sessions = yield* RedisSessions;
        const binary = new Uint8Array([0, 255, 128]);
        yield* redis.set(prefix, binary);
        expect(yield* redis.getBytes(prefix)).toEqual(Option.some(binary));

        const batch = yield* redis.pipeline([
          Commands.incr(`${prefix}:count`),
          Commands.get(`${prefix}:count`),
        ]);
        expect(Result.getOrThrow(batch[0])).toBe(1n);
        expect(Result.getOrThrow(batch[1])).toEqual(Option.some("1"));
        const committed = yield* sessions.withSession((session) =>
          session.transaction([Commands.incr(`${prefix}:count`)]),
        );
        expect(committed._tag).toBe("Committed");
        expect(yield* redis.get(`${prefix}:count`)).toEqual(Option.some("2"));
      }).pipe(Effect.provide(live));
    }),
);
