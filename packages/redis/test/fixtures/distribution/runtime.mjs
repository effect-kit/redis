import assert from "node:assert/strict";

import { Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";

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
assert.equal(script.sha1, "e0e1f9fabfc9d4800c877a703b823ac0578ff8db");
const random = await Effect.runPromise(
  SecureRandom.SecureRandom.pipe(
    Effect.flatMap((service) => service.randomBytes(65537)),
    Effect.provide(adapter.cryptoLayer),
  ),
);
assert.equal(random.length, 65537);
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
