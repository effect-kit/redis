import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";

it.live.each(primaryCases)(
  "CORE-SETS: $target.fixture $protocol membership, algebra and cardinality",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const a = `${prefix}:a`;
      const b = `${prefix}:b`;
      const out = `${prefix}:out`;
      const binary = new Uint8Array([0, 255]);

      expect(yield* redis.sadd(a, ["a", "b", binary])).toBe(3n);
      expect(yield* redis.sadd(b, ["b", "c"])).toBe(2n);
      expect(yield* redis.scard(a)).toBe(3n);
      expect(yield* redis.sismember(a, binary)).toBe(true);
      expect(yield* redis.smismember(a, ["missing", binary])).toEqual([false, true]);
      expect(yield* redis.smembers(a)).toEqual(
        expect.arrayContaining([bytes("a"), bytes("b"), binary]),
      );
      expect(yield* redis.sdiff([a, b])).toEqual(expect.arrayContaining([bytes("a"), binary]));
      expect(yield* redis.sinter([a, b])).toEqual([bytes("b")]);
      expect(yield* redis.sunion([a, b])).toHaveLength(4);
      expect(yield* redis.sdiffstore(out, [a, b])).toBe(2n);
      expect(yield* redis.sinterstore(out, [a, b])).toBe(1n);
      expect(yield* redis.sunionstore(out, [a, b])).toBe(4n);
      expect(yield* redis.srandmember(a)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.srandmemberCount(a, -4)).toHaveLength(4);
      expect(yield* redis.smove(a, b, "a")).toBe(true);
      expect(yield* redis.srem(b, ["missing", "a"])).toBe(1n);
      expect(yield* redis.spop(`${prefix}:missing`)).toEqual(Option.none());
      expect(yield* redis.spopCount(out, 2)).toHaveLength(2);

      if (target.product === "valkey" || atLeast(target.version, "7.0.0"))
        expect(yield* redis.sintercard([a, b], { limit: 1 })).toBe(1n);
      else {
        yield* absent(oracle, "SINTERCARD");
        expect(yield* Effect.flip(redis.sintercard([a, b]))).toMatchObject({ _tag: "ServerError" });
      }

      const modern = target.product === "redis" && atLeast(target.version, "8.10.0");
      if (modern) {
        expect(yield* redis.sdiffcard([a, b])).toBe(1n);
        expect(yield* redis.sunioncard([a, b])).toBe(3n);
        expect(
          yield* redis.sunioncard([a, b], { approximate: true, limit: 1 }),
        ).toBeGreaterThanOrEqual(1n);
      } else {
        for (const name of ["SDIFFCARD", "SUNIONCARD"]) yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.sdiffcard([a, b]))).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.sunioncard([a, b]))).toMatchObject({ _tag: "ServerError" });
      }
    }),
);
