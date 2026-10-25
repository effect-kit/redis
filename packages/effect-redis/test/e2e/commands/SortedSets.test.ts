import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";

it.live.each(primaryCases)(
  "CORE-SORTED-SETS: $target.fixture $protocol score, rank, lex and weighted algebra",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const a = `${prefix}:a`;
      const b = `${prefix}:b`;
      const out = `${prefix}:out`;

      expect(
        yield* redis.zadd(a, [
          [1, "a"],
          [2, "b"],
          [3, "c"],
        ]),
      ).toBe(3n);
      expect(yield* redis.zcard(a)).toBe(3n);
      expect(yield* redis.zaddIncrement(a, 1, "a")).toEqual(Option.some("2"));
      expect(yield* redis.zincrby(a, -1, "a")).toBe("1");
      expect(yield* redis.zmscore(a, ["a", "missing"])).toEqual([Option.some("1"), Option.none()]);
      expect(yield* redis.zrank(a, "a")).toEqual(Option.some(0n));
      expect(yield* redis.zrevrank(a, "a")).toEqual(Option.some(2n));
      expect(yield* redis.zcount(a, { exclusive: 1 }, "+inf")).toBe(2n);
      expect(yield* redis.zrange(a, { by: "rank", start: 0, end: -1 })).toEqual([
        bytes("a"),
        bytes("b"),
        bytes("c"),
      ]);
      expect(
        yield* redis.zrangeWithScores(a, {
          by: "score",
          min: 1,
          max: 3,
          reverse: true,
          limit: { offset: 0, count: 2 },
        }),
      ).toEqual([
        [bytes("c"), "3"],
        [bytes("b"), "2"],
      ]);
      expect(yield* redis.zrangestore(out, a, { by: "rank", start: 0, end: 1 })).toBe(2n);
      expect(yield* redis.zrevrange(a, 0, -1)).toHaveLength(3);
      expect(yield* redis.zrevrangeWithScores(a, 0, 0)).toEqual([[bytes("c"), "3"]]);
      expect(yield* redis.zrangebyscore(a, "-inf", "+inf")).toHaveLength(3);
      expect(yield* redis.zrangebyscoreWithScores(a, 1, 1)).toEqual([[bytes("a"), "1"]]);
      expect(yield* redis.zrevrangebyscore(a, 3, 1)).toHaveLength(3);
      expect(yield* redis.zrevrangebyscoreWithScores(a, 3, 3)).toEqual([[bytes("c"), "3"]]);
      expect(yield* redis.zrandmember(a)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.zrandmemberCount(a, -4)).toHaveLength(4);
      expect(yield* redis.zrandmemberWithScores(a, 2)).toHaveLength(2);

      yield* redis.zadd(b, [
        [2, "b"],
        [4, "d"],
      ]);
      expect(yield* redis.zdiff([a, b])).toEqual([bytes("a"), bytes("c")]);
      expect(yield* redis.zdiffWithScores([a, b])).toEqual([
        [bytes("a"), "1"],
        [bytes("c"), "3"],
      ]);
      expect(yield* redis.zdiffstore(out, [a, b])).toBe(2n);
      expect(yield* redis.zinter([a, b])).toEqual([bytes("b")]);
      expect(yield* redis.zinterWithScores([a, b], { weights: [2, 3], aggregate: "SUM" })).toEqual([
        [bytes("b"), "10"],
      ]);
      expect(yield* redis.zunion([a, b])).toHaveLength(4);
      expect(yield* redis.zunionWithScores([a, b], { aggregate: "MAX" })).toHaveLength(4);
      expect(yield* redis.zinterstore(out, [a, b])).toBe(1n);
      expect(yield* redis.zunionstore(out, [a, b])).toBe(4n);

      const lex = `${prefix}:lex`;
      yield* redis.zadd(lex, [
        [0, "a"],
        [0, "b"],
        [0, "c"],
      ]);
      expect(yield* redis.zlexcount(lex, { value: "a" }, { value: "c", exclusive: true })).toBe(2n);
      expect(yield* redis.zrange(lex, { by: "lex", min: "-", max: "+" })).toHaveLength(3);
      expect(yield* redis.zrangebylex(lex, "-", "+")).toHaveLength(3);
      expect(yield* redis.zrevrangebylex(lex, "+", "-")).toHaveLength(3);
      expect(yield* redis.zremrangebylex(lex, { value: "a" }, { value: "b" })).toBe(2n);
      expect(yield* redis.zremrangebyrank(lex, 0, -1)).toBe(1n);
      expect(yield* redis.zremrangebyscore(out, 0, "+inf")).toBe(4n);
      expect(yield* redis.zrem(a, ["missing"])).toBe(0n);
      expect(yield* redis.zpopmin(a)).toEqual([[bytes("a"), "1"]]);
      expect(yield* redis.zpopmax(a)).toEqual([[bytes("c"), "3"]]);

      if (target.product === "valkey" || atLeast(target.version, "7.0.0")) {
        expect(yield* redis.zintercard([a, b])).toBe(1n);
        expect(yield* redis.zmpop([a], "MIN")).toEqual(
          Option.some([bytes(a), [[bytes("b"), "2"]]]),
        );
      } else {
        for (const name of ["ZMPOP", "ZINTERCARD"]) yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.zmpop([a], "MIN"))).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.zintercard([a, b]))).toMatchObject({ _tag: "ServerError" });
      }

      if (atLeast(target.version, "7.2.0")) {
        expect(yield* redis.zrankWithScore(b, "b")).toEqual(Option.some([0n, "2"]));
        expect(yield* redis.zrevrankWithScore(b, "d")).toEqual(Option.some([0n, "4"]));
      } else {
        expect(yield* Effect.flip(redis.zrankWithScore(b, "b"))).toMatchObject({
          _tag: "ServerError",
        });
        expect(yield* Effect.flip(redis.zrevrankWithScore(b, "b"))).toMatchObject({
          _tag: "ServerError",
        });
      }

      if (target.product === "redis" && atLeast(target.version, "8.8.0"))
        expect(yield* redis.zinterWithScores([b, b], { aggregate: "COUNT" })).toEqual([
          [bytes("b"), "2"],
          [bytes("d"), "2"],
        ]);
      else
        expect(
          yield* Effect.flip(redis.zinterWithScores([b, b], { aggregate: "COUNT" })),
        ).toMatchObject({ _tag: "ServerError" });
    }),
);
