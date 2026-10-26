import { Effect, Option } from "effect";

import type { RedisClient } from "@effect-kit/redis";

import { ensure, sameBytes, utf8 } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";

export const collections = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check, record }: ReturnType<typeof assertions>,
  transport: "native" | "http" = "native",
) {
  const field = transport === "native" ? new Uint8Array([255, 0, 128]) : utf8("field");
  const value = new Uint8Array([0, 255, 10]);
  if (transport === "http") {
    yield* check(
      "collections.binary-middle-unsent",
      Effect.result(redis.hset(`${prefix}hash`, [[new Uint8Array([255]), "ignored"]])),
      (reply) =>
        ensure(
          reply._tag === "Failure" &&
            reply.failure._tag === "UpstashError" &&
            reply.failure.delivery === "unsent",
          "binary-middle",
        ),
    );
    record(
      "collections.http-input-limit",
      "limited",
      "Arbitrary binary arguments require an ordinary final-body position",
    );
  }
  yield* check("collections.hash-write", redis.hset(`${prefix}hash`, [[field, value]]), (reply) =>
    ensure(reply === 1n, "hset"),
  );
  yield* check("collections.hash-second", redis.hset(`${prefix}hash`, [["OK", "OK"]]), (reply) =>
    ensure(reply === 1n, "hset-second"),
  );
  yield* check("collections.hash-pairs", redis.hgetall(`${prefix}hash`), (reply) => {
    ensure(reply.length === 2, "hash-pairs");
    ensure(
      reply.some(([key, bytes]) => sameBytes(key, field) && sameBytes(bytes, value)),
      "binary-field",
    );
    ensure(
      reply.some(([key, bytes]) => sameBytes(key, utf8("OK")) && sameBytes(bytes, utf8("OK"))),
      "ok-field",
    );
  });
  yield* check("collections.list-write", redis.rpush(`${prefix}list`, ["雪", value]), (reply) =>
    ensure(reply === 2n, "rpush"),
  );
  yield* check("collections.list-read", redis.lrange(`${prefix}list`, 0, -1), (reply) =>
    ensure(
      reply.length === 2 && sameBytes(reply[0], utf8("雪")) && sameBytes(reply[1], value),
      "lrange",
    ),
  );
  yield* check("collections.set-write", redis.sadd(`${prefix}set`, ["member", value]), (reply) =>
    ensure(reply === 2n, "sadd"),
  );
  yield* check("collections.set-read", redis.smembers(`${prefix}set`), (reply) =>
    ensure(reply.length === 2 && reply.some((bytes) => sameBytes(bytes, value)), "smembers"),
  );
  yield* check("collections.score-write", redis.zadd(`${prefix}sorted`, [[1.25, value]]), (reply) =>
    ensure(reply === 1n, "zadd"),
  );
  yield* check("collections.score-read", redis.zscore(`${prefix}sorted`, value), (reply) =>
    ensure(Option.isSome(reply) && reply.value === 1.25, "zscore"),
  );
  yield* check(
    "collections.stream-write",
    redis.xadd(`${prefix}stream`, "1-0", [[field, value]]),
    (reply) => ensure(reply === "1-0", "xadd"),
  );
  yield* check("collections.stream-read", redis.xrange(`${prefix}stream`, "-", "+"), (reply) =>
    ensure(
      reply.length === 1 &&
        reply[0]?.id === "1-0" &&
        sameBytes(reply[0]?.fields[0]?.[0], field) &&
        sameBytes(reply[0]?.fields[0]?.[1], value),
      "xrange",
    ),
  );
});
