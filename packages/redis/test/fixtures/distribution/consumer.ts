import { Config, Effect, Layer, Redacted, Schema } from "effect";

import {
  Commands,
  PayloadCodec,
  Redis,
  RedisKey,
  RedisProfiles,
  RedisScript,
  RedisScripts,
  RedisSessions,
  RedisStreams,
  RedisTelemetry,
  Reply,
} from "@effect-kit/redis";
import { RedisBun } from "@effect-kit/redis/bun";
import { RedisNode } from "@effect-kit/redis/node";
import { RedisUpstash } from "@effect-kit/redis/upstash";

const key = RedisKey.json("example:profile", Schema.Struct({ name: Schema.String }));
const script = RedisScript.make({ source: "return 1", decode: Reply.integer });

export const example = Effect.gen(function* () {
  const redis = yield* Redis;
  yield* redis.setKey(key, { name: "example" });
  const profile = yield* redis.getKey(key);
  const pipeline = yield* redis.pipeline([Commands.getKey(key), Commands.incr("example:visits")]);
  const transaction = yield* redis.transaction([
    Commands.set("example:value", "OK"),
    Commands.getBytes("example:value"),
  ]);
  const raw = yield* redis.raw(["PING"], { execution: "ordinary", routing: { _tag: "Keyless" } });
  const sessions = yield* RedisSessions;
  yield* sessions.watch(["example:value"], (session) =>
    session.transaction([Commands.getBytes("example:value")]),
  );
  return {
    profile,
    pipeline,
    transaction,
    raw,
    scripts: yield* RedisScripts,
    streams: yield* RedisStreams,
  };
});

const free = RedisProfiles.redisCloud({
  plan: "free",
  routing: "proxy",
  authentication: "password",
});
export const native = example.pipe(
  Effect.provide(
    Layer.mergeAll(
      RedisNode.layer({ url: "redis://localhost", profile: free }),
      RedisTelemetry.layer({ tracing: true }),
    ),
  ),
);
export const bun = example.pipe(Effect.provide(RedisBun.layer({ url: "redis://localhost" })));
export const http = RedisUpstash.layerConfig(
  Config.succeed({ url: "https://example.invalid", token: Redacted.make("synthetic") }),
);
export const codec = PayloadCodec.json(Schema.Struct({ enabled: Schema.Boolean }));
void script;

// @ts-expect-error Public plans preserve free proxy routing constraints.
RedisProfiles.redisCloud({ plan: "free", routing: "cluster", authentication: "password" });
// @ts-expect-error Explicit Schema keys do not accept arbitrary application payloads.
Redis.pipe(Effect.flatMap((redis) => redis.setKey(key, { name: 1 })));
