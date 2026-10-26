import { Effect, Option, Result } from "effect";

import { core, ensure, native } from "#test/runners/bun/Runtime";
import { nativeInput } from "#test/support/client/Input";

export const readyClient = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  return yield* Effect.gen(function* () {
    const redis = yield* core.Redis;
    const identity = yield* core.RedisCredentials;
    const key = `ready-bun:${crypto.randomUUID()}`;
    yield* redis.set(key, "0");
    const results = yield* redis.pipeline([core.Commands.incr(key), core.Commands.get(key)]);
    ensure(Result.getOrThrow(results[0]) === 1n, "Ready Bun batch changed integer reply");
    ensure(Option.getOrThrow(Result.getOrThrow(results[1])) === "1", "Ready Bun batch lost order");
    yield* identity.rotate;
    ensure(Option.getOrThrow(yield* redis.get(key)) === "1", "Ready Bun rotation failed");
    return ["ready-layer", "ready-batches", "deliberate-rotation"];
  }).pipe(Effect.provide(native.RedisBun.layer(nativeInput(config))));
});
