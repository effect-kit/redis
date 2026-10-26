import assert from "node:assert/strict";

import { Effect, Option, Result } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

export const batches = Effect.fnUntraced(function* ({
  sessions,
  redis,
  prefix,
  raw,
  record,
  policy,
}: Client) {
  const C = core.Commands;
  const key = `${prefix}:batch`;
  const counter = `${key}:counter`;
  const binary = new Uint8Array([0, 255]);
  const wrongCode = policy.engine === "kvrocks" ? "ERR" : "WRONGTYPE";

  const pipeline = yield* sessions.pipeline([
    C.set(key, binary),
    C.getBytes(key),
    C.incr(counter),
    C.lpop(key),
    C.incr(counter),
  ]);
  assert.ok(Result.isSuccess(pipeline[0]));
  assert.deepEqual(pipeline[1], Result.succeed(Option.some(binary)));
  assert.deepEqual(pipeline[2], Result.succeed(1n));
  assert.ok(Result.isFailure(pipeline[3]));
  assert.ok(pipeline[3].failure instanceof core.ServerError);
  assert.equal(pipeline[3].failure.code, wrongCode);
  assert.deepEqual(pipeline[4], Result.succeed(2n));
  record("sessions.pipeline-order-errors", "PIPELINE");

  const transaction = yield* sessions.transaction([C.incr(counter), C.lpop(key), C.incr(counter)]);
  assert.equal(transaction._tag, "Committed");
  if (transaction._tag !== "Committed") return yield* Effect.die("Missing committed result");
  assert.deepEqual(transaction.results[0], Result.succeed(3n));
  assert.ok(Result.isFailure(transaction.results[1]));
  assert.deepEqual(transaction.results[2], Result.succeed(4n));
  assert.deepEqual(yield* redis.get(counter), Option.some("4"));
  record("sessions.exec-runtime-error-no-rollback", "EXEC");

  const rejected = yield* Effect.flip(
    sessions.transaction([
      C.incr(counter),
      C.raw(["INCR", counter, "extra"], {
        execution: "ordinary",
        routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
      }),
    ]),
  );
  assert.ok(rejected instanceof core.TransactionError);
  assert.equal(rejected.execution, "not-executed");
  assert.deepEqual(yield* redis.get(counter), Option.some("4"));
  record("sessions.queue-rejection", "MULTI");

  yield* redis.set(key, "initial");
  const conflict = yield* sessions.watch([key], (session) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* session.get(key), Option.some("initial"));
      yield* raw(["SET", key, "competitor"]);
      return yield* session.transaction([C.set(key, "ours")]);
    }),
  );
  assert.deepEqual(conflict, { _tag: "Conflict" });
  assert.deepEqual(yield* redis.get(key), Option.some("competitor"));
  yield* sessions.watch([key], (session) => session.get(key));
  yield* redis.set(key, "after-cleanup");
  assert.equal((yield* sessions.transaction([C.incr(counter)]))._tag, "Committed");
  assert.equal((yield* sessions.snapshot).leased, 0);
  record("sessions.watch-conflict-cleanup", "WATCH");
});
