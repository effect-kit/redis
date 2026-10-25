import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import type { Command } from "#/index";
import { atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";

it.live.each(primaryCases)(
  "CORE-EDGES: $target.fixture $protocol missing values, binary keys and server errors",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* backend(target, protocol);
      const missing = `${prefix}:missing`;
      const hash = `${prefix}:hash`;
      const binaryKey = new Uint8Array([...bytes(prefix), 0, 255]);
      const binaryValue = new Uint8Array([255, 0, 13, 10]);

      expect(yield* redis.hgetall(missing)).toEqual([]);
      expect(yield* redis.lrange(missing, 0, -1)).toEqual([]);
      expect(yield* redis.smembers(missing)).toEqual([]);
      expect(yield* redis.spopCount(missing, 0)).toEqual([]);
      expect(yield* redis.zrange(missing, { by: "rank", start: 0, end: -1 })).toEqual([]);
      expect(yield* redis.zpopmin(missing, 0)).toEqual([]);
      expect(yield* redis.geodist(missing, "a", "b")).toEqual(Option.none());
      expect(yield* redis.pfcount([missing])).toBe(0n);
      expect(
        yield* redis.bitfieldRo(missing, [
          { operation: "GET", encoding: { signed: true, bits: 8 }, offset: 0 },
        ]),
      ).toEqual([0n]);

      yield* redis.rpush(binaryKey, [binaryValue]);
      expect(yield* redis.lpopCount(binaryKey, 0)).toEqual(Option.some([]));
      expect(yield* redis.lpop(binaryKey)).toEqual(Option.some(binaryValue));
      yield* redis.zadd(binaryKey, [["+inf", binaryValue]]);
      expect(
        yield* redis.zrangeWithScores(binaryKey, { by: "score", min: "-inf", max: "+inf" }),
      ).toEqual([[binaryValue, "inf"]]);

      yield* redis.hset(hash, [["f", "v"]]);
      const wrongTypes: ReadonlyArray<Command<unknown>> = [
        Commands.getBytes(hash),
        Commands.llen(hash),
        Commands.scard(hash),
        Commands.zcard(hash),
        Commands.geohash(hash, ["member"]),
        Commands.bitcount(hash),
      ];
      for (const command of wrongTypes)
        expect(yield* Effect.flip(redis.execute(command))).toMatchObject({
          _tag: "ServerError",
          code: "WRONGTYPE",
        });

      yield* redis.set(`${prefix}:invalid-hll`, "invalid");
      expect(yield* Effect.flip(redis.pfcount([`${prefix}:invalid-hll`]))).toMatchObject({
        _tag: "ServerError",
      });
      expect(yield* Effect.flip(redis.rename(missing, `${prefix}:destination`))).toMatchObject({
        _tag: "ServerError",
      });

      if (target.product === "redis" && atLeast(target.version, "8.8.0")) {
        expect(yield* redis.arlastitems(missing, 0)).toEqual([]);
        expect(yield* Effect.flip(redis.arcount(hash))).toMatchObject({
          _tag: "ServerError",
          code: "WRONGTYPE",
        });
      }

      // Replied command failures must leave the ordered connection usable.
      yield* redis.ping();
    }),
);
