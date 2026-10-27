import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Effect, Option, Redacted, Result, Schema } from "effect";

import { Commands, Redis, RedisKey } from "@effect-kit/redis";
import { RedisUpstash } from "@effect-kit/redis/upstash";

const chunks = [];

for await (const chunk of process.stdin) chunks.push(chunk);

const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const adapter =
  input.runtime === "bun"
    ? (await import("@effect-kit/redis/bun")).RedisBun
    : (await import("@effect-kit/redis/node")).RedisNode;
const checks = [];

for (const [transport, layer] of [
  ["native", adapter.layer({ endpoint: input.endpoint })],
  ["http", RedisUpstash.layer({ ...input.http, token: Redacted.make(input.http.token) })],
]) {
  const prefix = `packed-release:${randomUUID()}`;
  const valueKey = `${prefix}:value`;
  const countKey = `${prefix}:count`;
  const profileKey = RedisKey.json(`${prefix}:profile`, Schema.Struct({ name: Schema.String }));

  // oxlint-disable-next-line no-await-in-loop -- Each transport must finish and release its connections before the next probe.
  await Effect.runPromise(
    Effect.gen(function* () {
      const redis = yield* Redis;

      yield* Effect.addFinalizer(() =>
        redis.del([valueKey, countKey, profileKey.name]).pipe(Effect.orDie),
      );

      yield* redis.set(valueKey, "Hello from Effect", { expiry: { type: "EX", value: 60 } });
      assert.deepEqual(yield* redis.get(valueKey), Option.some("Hello from Effect"));
      checks.push(`${transport}:text`);

      yield* redis.set(valueKey, "9007199254740992");
      assert.equal(yield* redis.incr(valueKey), 9007199254740993n);
      yield* redis.set(valueKey, new Uint8Array([0, 255, 128]));
      assert.deepEqual(yield* redis.getBytes(valueKey), Option.some(new Uint8Array([0, 255, 128])));
      checks.push(`${transport}:bytes-int64`);

      yield* redis.setKey(profileKey, { name: "Ada" });
      assert.deepEqual(yield* redis.getKey(profileKey), Option.some({ name: "Ada" }));
      checks.push(`${transport}:schema`);

      const pipeline = yield* redis.pipeline([
        Commands.getKey(profileKey),
        Commands.incr(countKey),
      ]);
      assert.deepEqual(Result.getOrThrow(pipeline[0]), Option.some({ name: "Ada" }));
      assert.equal(Result.getOrThrow(pipeline[1]), 1n);

      const transaction = yield* redis.transaction([
        Commands.incr(countKey),
        Commands.get(countKey),
      ]);
      assert.equal(transaction._tag, "Committed");
      assert.equal(Result.getOrThrow(transaction.results[0]), 2n);
      assert.deepEqual(Result.getOrThrow(transaction.results[1]), Option.some("2"));
      checks.push(`${transport}:batches`);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}

console.log(
  JSON.stringify({
    runtime: input.runtime,
    version: input.runtime === "bun" ? Bun.version : process.versions.node,
    checks,
  }),
);
