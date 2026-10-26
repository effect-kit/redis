import assert from "node:assert/strict";

import { Effect, Layer } from "effect";

import { Commands, RedisProfiles, RedisScript, RedisTelemetry, Reply } from "@effect-kit/redis";
import { decodeUpstashConfig } from "@effect-kit/redis/upstash";

const runtime = process.argv[2];
const adapter =
  runtime === "bun"
    ? await import("@effect-kit/redis/bun")
    : await import("@effect-kit/redis/node");
const prepared = await Effect.runPromise(
  Commands.setex("example", 30, new Uint8Array([0, 255])).prepare,
);
assert.equal(prepared.tokens[0], "SETEX");
assert.equal(
  RedisProfiles.redisCloud({ plan: "free", routing: "proxy", authentication: "password" }).tls,
  "optional",
);
const script = await Effect.runPromise(
  RedisScript.make({ source: "return 1", decode: Reply.integer }).pipe(
    Effect.provide(adapter.cryptoLayer),
  ),
);
assert.match(script.sha1, /^[a-f0-9]{40}$/);
await Effect.runPromise(Effect.scoped(Layer.build(RedisTelemetry.layer({ tracing: true }))));
assert.equal(typeof decodeUpstashConfig, "function");
console.log(
  JSON.stringify({
    runtime,
    version: runtime === "bun" ? Bun.version : process.versions.node,
    publicImports: true,
    explicitBytes: true,
    scriptCrypto: true,
    telemetry: true,
  }),
);
