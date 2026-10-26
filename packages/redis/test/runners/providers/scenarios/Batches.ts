import { Effect, Option, Result } from "effect";

import { Commands, RedisCredentials, Reply } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";

import { ensure, sameBytes, utf8 } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";
import { oracleBytes } from "#test/runners/providers/scenarios/Identity";

export const batches = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check }: ReturnType<typeof assertions>,
  transport: "native" | "http",
) {
  const key = `${prefix}batch`;
  yield* check(
    "batches.pipeline",
    redis.pipeline([Commands.set(key, "OK"), Commands.incr(key), Commands.getBytes(key)]),
    (reply) => {
      ensure(reply.length === 3 && Result.isSuccess(reply[0]), "pipeline-status");
      ensure(
        Result.isFailure(reply[1]) && reply[1].failure._tag === "ServerError",
        "pipeline-error",
      );
      ensure(
        Result.isSuccess(reply[2]) &&
          Option.isSome(reply[2].success) &&
          sameBytes(reply[2].success.value, utf8("OK")),
        "pipeline-blob",
      );
    },
    3,
  );
  yield* check(
    "batches.integer-initialize",
    redis.set(`${prefix}integer`, "9007199254740993"),
    () => {},
  );
  yield* check(
    "batches.transaction",
    redis.transaction([
      Commands.getBytes(key),
      Commands.incr(`${prefix}integer`),
      Commands.incr(key),
      Commands.set(`${prefix}after-error`, "survived"),
    ]),
    (reply) => {
      ensure(reply._tag === "Committed", "transaction-committed");
      if (reply._tag !== "Committed") return;
      ensure(
        Result.isSuccess(reply.results[0]) &&
          Option.isSome(reply.results[0].success) &&
          sameBytes(reply.results[0].success.value, utf8("OK")),
        "transaction-blob",
      );
      ensure(
        Result.isSuccess(reply.results[1]) && reply.results[1].success === 9007199254740994n,
        "transaction-int64",
      );
      ensure(
        Result.isFailure(reply.results[2]) && Result.isSuccess(reply.results[3]),
        "transaction-runtime-error",
      );
    },
    6,
  );
  yield* check("batches.no-rollback", redis.get(`${prefix}after-error`), (reply) =>
    ensure(Option.isSome(reply) && reply.value === "survived", "no-rollback"),
  );

  if (transport === "http") {
    yield* check(
      "batches.json-binary-hash-fields",
      redis.transaction([Commands.hgetall(`${prefix}json-hash`)]),
      (reply) => {
        ensure(reply._tag === "Committed", "json-hash-committed");
        const result = reply.results[0];
        ensure(Result.isSuccess(result), "json-hash-result");
        ensure(
          result.success.length === 2 &&
            result.success.some(
              ([field, value]) => sameBytes(field, oracleBytes) && sameBytes(value, oracleBytes),
            ) &&
            result.success.some(
              ([field, value]) => sameBytes(field, utf8("OK")) && sameBytes(value, utf8("OK")),
            ),
          "json-hash-binary-fields",
        );
      },
    );
    yield* check(
      "batches.ambiguous-script-rejected",
      Effect.result(
        redis.transaction([Commands.evalScript("return 'OK'", { keys: [], args: [] }, Reply.blob)]),
      ),
      (reply) =>
        ensure(
          reply._tag === "Failure" &&
            reply.failure._tag === "UpstashError" &&
            reply.failure.delivery === "unsent",
          "ambiguous-script",
        ),
    );
    yield* check(
      "batches.blocking-rejected",
      Effect.result(redis.execute(Commands.blpop([`${prefix}list`], { blockFor: "forever" }))),
      (reply) =>
        ensure(
          reply._tag === "Failure" &&
            reply.failure._tag === "UpstashError" &&
            reply.failure.delivery === "unsent",
          "blocking-rejected",
        ),
    );
  }

  const credentials = yield* RedisCredentials;
  yield* credentials.rotate;
  yield* check("batches.explicit-rotation-future-work", redis.get(key), (reply) =>
    ensure(Option.isSome(reply) && reply.value === "OK", "rotation"),
  );
});
