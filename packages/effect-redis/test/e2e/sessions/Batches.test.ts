import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SESSION-BATCH: $target.fixture $protocol pipelines, EXEC and queue rejection",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, oracle, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:value`;
      const counter = `${prefix}:counter`;
      const binary = new Uint8Array([0, 255, 13, 10]);

      const pipeline = yield* sessions.pipeline([
        Commands.set(key, binary),
        Commands.getBytes(key),
        Commands.incr(counter),
        Commands.lpop(key),
        Commands.incr(counter),
      ]);
      expect(pipeline).toMatchObject([
        { _tag: "Success" },
        { success: Option.some(binary) },
        { success: 1n },
        { failure: { _tag: "ServerError", code: "WRONGTYPE" } },
        { success: 2n },
      ]);
      expect(yield* exchange(oracle, ["GET", counter])).toEqual({
        _tag: "BlobString",
        value: bytes("2"),
      });

      const transaction = yield* sessions.transaction([
        Commands.incr(counter),
        Commands.lpop(key),
        Commands.incr(counter),
      ]);
      expect(transaction).toMatchObject({
        _tag: "Committed",
        results: [{ success: 3n }, { failure: { code: "WRONGTYPE" } }, { success: 4n }],
      });
      expect(yield* exchange(oracle, ["GET", counter])).toEqual({
        _tag: "BlobString",
        value: bytes("4"),
      });

      const rejected = yield* Effect.flip(
        sessions.transaction([
          Commands.incr(counter),
          Commands.raw(["INCR", counter, "extra"], {
            execution: "ordinary",
            routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
          }),
        ]),
      );
      expect(rejected).toMatchObject({
        _tag: "TransactionError",
        reason: "queue-rejected",
        execution: "not-executed",
      });
      expect(yield* exchange(oracle, ["GET", counter])).toEqual({
        _tag: "BlobString",
        value: bytes("4"),
      });
      expect(yield* sessions.transaction([])).toEqual({ _tag: "Committed", results: [] });
    }),
);

it.live.each(primaryCases)(
  "SESSION-WATCH: $target.fixture $protocol conflicts and early-return cleanup",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, redis, oracle, prefix } = yield* sessionBackend(target, protocol);
      const key = `${prefix}:watched`;
      yield* redis.set(key, "initial");

      const conflicted = yield* sessions.watch([key], (session) =>
        Effect.gen(function* () {
          expect(yield* session.get(key)).toEqual(Option.some("initial"));
          yield* exchange(oracle, ["SET", key, "competitor"]);
          return yield* session.transaction([Commands.set(key, "ours")]);
        }),
      );
      expect(conflicted).toEqual({ _tag: "Conflict" });
      expect(yield* redis.get(key)).toEqual(Option.some("competitor"));

      yield* sessions.watch([key], (session) => session.get(key));
      yield* redis.set(key, "after-cleanup");
      const committed = yield* sessions.transaction([Commands.incr(`${prefix}:counter`)]);
      expect(committed).toMatchObject({ _tag: "Committed", results: [{ success: 1n }] });
      expect(yield* sessions.snapshot).toMatchObject({ connections: 1, idle: 1, leased: 0 });
    }),
);
