import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-BITMAPS: $target.fixture $protocol bits, signed fields and overflow state",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const key = `${prefix}:bits`;

      expect(yield* redis.getbit(key, 0)).toBe(0);
      expect(yield* redis.setbit(key, 0, 1)).toBe(0);
      expect(yield* redis.setbit(key, 7, 1)).toBe(0);
      expect(yield* redis.bitcount(key)).toBe(2n);
      expect(yield* redis.bitcount(key, { start: 0, end: 0 })).toBe(2n);
      expect(yield* redis.bitpos(key, 1)).toBe(0n);
      expect(yield* redis.bitop("NOT", `${key}:not`, [key])).toBe(1n);
      expect(yield* exchange(oracle, ["GET", `${key}:not`])).toEqual({
        _tag: "BlobString",
        value: new Uint8Array([126]),
      });

      const field = `${prefix}:field`;
      expect(
        yield* redis.bitfield(field, [
          { operation: "SET", encoding: { signed: false, bits: 3 }, offset: 0, value: 7 },
          {
            operation: "INCRBY",
            encoding: { signed: false, bits: 3 },
            offset: 0,
            value: 1,
            overflow: "FAIL",
          },
          { operation: "GET", encoding: { signed: false, bits: 3 }, offset: 0 },
          {
            operation: "SET",
            encoding: { signed: true, bits: 64 },
            offset: { index: 1 },
            value: -9007199254740993n,
          },
        ]),
      ).toEqual([Option.some(0n), Option.none(), Option.some(7n), Option.some(0n)]);
      expect(
        yield* redis.bitfieldRo(field, [
          { operation: "GET", encoding: { signed: true, bits: 64 }, offset: 64 },
        ]),
      ).toEqual([-9007199254740993n]);

      if (target.product === "valkey" || atLeast(target.version, "7.0.0"))
        expect(yield* redis.bitcount(key, { start: 0, end: 3, unit: "BIT" })).toBe(1n);
      else
        expect(
          yield* Effect.flip(redis.bitcount(key, { start: 0, end: 3, unit: "BIT" })),
        ).toMatchObject({ _tag: "ServerError" });

      if (target.product === "redis" && atLeast(target.version, "8.2.0"))
        expect(yield* redis.bitop("DIFF", `${key}:diff`, [key, `${key}:not`])).toBe(1n);
      else
        expect(
          yield* Effect.flip(redis.bitop("DIFF", `${key}:diff`, [key, `${key}:not`])),
        ).toMatchObject({ _tag: "ServerError" });
    }),
);
