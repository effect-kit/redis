import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SCAN-LIVE: $target.fixture $protocol binary collections and range iteration",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* sessionBackend(target, protocol);
      const binary = new Uint8Array([0, 255]);
      yield* redis.set(`${prefix}:string`, binary);
      yield* redis.hset(`${prefix}:hash`, [[binary, binary]]);
      yield* redis.sadd(`${prefix}:set`, [binary]);
      yield* redis.zadd(`${prefix}:sorted`, [[1.5, binary]]);

      expect(yield* Stream.runCollect(redis.scanKeys({ match: `${prefix}:*`, count: 1 }))).toEqual(
        expect.arrayContaining([
          bytes(`${prefix}:string`),
          bytes(`${prefix}:hash`),
          bytes(`${prefix}:set`),
          bytes(`${prefix}:sorted`),
        ]),
      );
      expect(yield* Stream.runCollect(redis.scanHash(`${prefix}:hash`))).toEqual([
        [binary, binary],
      ]);
      expect(yield* Stream.runCollect(redis.scanSet(`${prefix}:set`))).toEqual([binary]);
      expect(yield* Stream.runCollect(redis.scanSortedSet(`${prefix}:sorted`))).toEqual([
        [binary, "1.5"],
      ]);
      if (
        (target.product === "redis" && atLeast(target.version, "7.4.0")) ||
        (target.product === "valkey" && atLeast(target.version, "8.0.0"))
      )
        expect((yield* redis.hscanFields(`${prefix}:hash`)).entries).toEqual([binary]);
      else
        expect(yield* Effect.flip(redis.hscanFields(`${prefix}:hash`))).toMatchObject({
          _tag: "ServerError",
        });
      if (target.product === "valkey" && atLeast(target.version, "8.0.0"))
        expect((yield* redis.zscanMembers(`${prefix}:sorted`)).entries).toEqual([binary]);
      else
        expect(yield* Effect.flip(redis.zscanMembers(`${prefix}:sorted`))).toMatchObject({
          _tag: "ServerError",
        });

      if (target.product === "redis" && atLeast(target.version, "8.8.0")) {
        yield* redis.armset(`${prefix}:array`, [
          [1, binary],
          [9007199254740993n, "last"],
        ]);
        expect(
          yield* Stream.runCollect(
            redis.scanArray(`${prefix}:array`, 18446744073709551614n, 0, { limit: 1 }),
          ),
        ).toEqual([
          [9007199254740993n, bytes("last")],
          [1n, binary],
        ]);
      } else
        expect(yield* Effect.flip(redis.arscan(`${prefix}:array`, 0, 1))).toMatchObject({
          _tag: "ServerError",
        });
    }),
);
