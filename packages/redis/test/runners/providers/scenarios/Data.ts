import { Effect, Option, Schema } from "effect";

import { RedisKey } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";

import { ensure, sameBytes, utf8 } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";

export const data = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check }: ReturnType<typeof assertions>,
) {
  const key = `${prefix}value`;
  const binary = new Uint8Array([0, 255, 128, 13, 10, 239, 187, 191]);

  yield* check("data.ping", redis.ping(), () => {});
  yield* check("data.missing", redis.getBytes(`${prefix}absent`), (reply) =>
    ensure(Option.isNone(reply), "missing"),
  );
  yield* check("data.binary-set", redis.set(key, binary), () => {});
  yield* check("data.binary-get", redis.getBytes(key), (reply) =>
    ensure(Option.isSome(reply) && sameBytes(reply.value, binary), "binary"),
  );
  yield* check("data.empty-set", redis.set(key, ""), () => {});
  yield* check("data.empty-get", redis.get(key), (reply) =>
    ensure(Option.isSome(reply) && reply.value === "", "empty"),
  );
  yield* check("data.ok-set", redis.set(key, "OK"), () => {});
  yield* check("data.ok-blob", redis.getBytes(key), (reply) =>
    ensure(Option.isSome(reply) && sameBytes(reply.value, utf8("OK")), "ok-blob"),
  );
  yield* check("data.condition", redis.set(key, "ignored", { condition: "NX" }), (reply) =>
    ensure(reply === false, "condition"),
  );
  yield* check("data.previous", redis.set(key, "雪", { get: true }), (reply) =>
    ensure(Option.isSome(reply) && sameBytes(reply.value, utf8("OK")), "previous"),
  );
  yield* check(
    "data.int64-initialize",
    redis.set(`${prefix}integer`, "9007199254740993"),
    () => {},
  );
  yield* check("data.int64", redis.incr(`${prefix}integer`), (reply) =>
    ensure(reply === 9007199254740994n, "int64"),
  );
  yield* check(
    "data.negative-int64",
    redis.incrby(`${prefix}integer`, -9007199254740995n),
    (reply) => ensure(reply === -1n, "negative-int64"),
  );

  const profile = RedisKey.json(
    `${prefix}schema`,
    Schema.Struct({ name: Schema.String, count: Schema.Int }),
  );
  yield* check(
    "data.schema-write",
    redis.setKey(profile, { name: "BOM\ufeff雪", count: 3 }),
    () => {},
  );
  yield* check("data.schema-read", redis.getKey(profile), (reply) =>
    ensure(
      Option.isSome(reply) && reply.value.name === "BOM\ufeff雪" && reply.value.count === 3,
      "schema",
    ),
  );
  yield* check("data.wrong-type", Effect.result(redis.incr(key)), (reply) =>
    ensure(reply._tag === "Failure" && reply.failure._tag === "ServerError", "wrong-type"),
  );

  yield* check("data.invalid-utf8-write", redis.set(key, new Uint8Array([255])), () => {});
  yield* check("data.strict-text", Effect.result(redis.get(key)), (reply) =>
    ensure(reply._tag === "Failure" && reply.failure._tag === "ReplyError", "strict-text"),
  );
});
