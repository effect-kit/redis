import { Effect, Option } from "effect";

import { Commands } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";

import { ensure, sameBytes } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";

export const oracleBytes = new Uint8Array([0, 255, 128, 13, 10, 79, 75]);

export const identity = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check }: ReturnType<typeof assertions>,
) {
  yield* check("identity.independent-native-input", redis.getBytes(`${prefix}oracle-in`), (reply) =>
    ensure(Option.isSome(reply) && sameBytes(reply.value, oracleBytes), "oracle-input"),
  );
  yield* check(
    "identity.native-verifiable-output",
    // HTTP can carry arbitrary bytes only in the final argument/body position.
    redis.setex(`${prefix}oracle-out`, 300, oracleBytes),
    () => {},
  );

  const reply = yield* redis.raw(["INFO", "SERVER"], {
    execution: "ordinary",
    routing: { _tag: "Keyless" },
  });
  const info = yield* Commands.decodeInfo(reply);
  const fields = new Map(info.sections.flatMap((section) => section.fields));
  const server: { redisVersion?: string; valkeyVersion?: string; mode?: string } = {};
  for (const [field, property] of [
    ["redis_version", "redisVersion"],
    ["valkey_version", "valkeyVersion"],
    ["redis_mode", "mode"],
  ] as const) {
    const value = fields.get(field);
    if (value !== undefined && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) server[property] = value;
  }

  return server;
});
