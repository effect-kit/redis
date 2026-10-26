import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Clock, Config, Effect, Option, Redacted, Result } from "effect";

import { checkServerReply } from "#/command/Decode";
import {
  Commands,
  Redis,
  RedisCredentials,
  RedisProfiles,
  RedisSessions,
  decodeRedisConfig,
} from "#/index";
import { RedisNode, connect } from "#/node";
import { exchange } from "#test/support/networking/Exchange";
import { dockerServer } from "#test/support/servers/DockerServer";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";

const profiles = [
  RedisProfiles.redis(),
  RedisProfiles.valkey(),
  RedisProfiles.dragonfly(),
  RedisProfiles.keydb(),
  RedisProfiles.redict(),
  RedisProfiles.garnet(),
  RedisProfiles.kvrocks(),
];

const targets = serverTargets.filter(
  (target) =>
    target.fixture === target.product &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

it.live.each(targets.filter((target) => ["redis", "valkey"].includes(target.product)))(
  "IDENTITY-LIVE: $fixture changes ACL passwords and refreshes only future physical connections",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const endpoint = { host: "127.0.0.1", port: server.port };
      const oracle = yield* connect(yield* decodeRedisConfig({ endpoint }));
      let secret = randomUUID();
      let acquisitions = 0;
      const update = () =>
        exchange(oracle, [
          "ACL",
          "SETUSER",
          "rotating",
          "reset",
          "on",
          `>${secret}`,
          "~*",
          "+@all",
        ]).pipe(Effect.flatMap(checkServerReply));
      yield* update();
      const credentials = RedisCredentials.provider(
        Effect.gen(function* () {
          acquisitions++;
          return {
            username: Redacted.make("rotating"),
            password: Redacted.make(secret),
            expiresAtMillis: (yield* Clock.currentTimeMillis) + 3_600_000,
          };
        }),
      );
      yield* Effect.gen(function* () {
        const redis = yield* Redis;
        const identity = yield* RedisCredentials;
        yield* redis.set("rotation-owned-counter", "0");
        secret = randomUUID();
        yield* update();
        expect(yield* redis.incr("rotation-owned-counter")).toBe(1n);
        expect(acquisitions).toBe(1);

        yield* identity.rotate;
        expect(yield* redis.incr("rotation-owned-counter")).toBe(2n);
        expect(acquisitions).toBe(2);
        expect(yield* redis.get("rotation-owned-counter")).toEqual(Option.some("2"));
      }).pipe(Effect.provide(RedisNode.layer({ endpoint, credentials, protocol: "resp3" })));
    }),
);

it.live.each(targets)(
  "PRESET: $fixture one Node Layer supplies ordinary commands and leased batches",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const prefix = `preset:${randomUUID()}`;
      const profile = profiles.find((candidate) => candidate.id === target.product);
      if (profile === undefined) return yield* Effect.die("Missing engine profile");
      const live = RedisNode.layerConfig(
        Config.succeed({
          url: `redis://127.0.0.1:${server.port}`,
          protocol: "resp2" as const,
          profile,
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
