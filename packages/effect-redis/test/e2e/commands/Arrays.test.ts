import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";

it.live.each(primaryCases)(
  "CORE-ARRAYS: $target.fixture $protocol sparse slots, predicates and unsigned cursors",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const key = `${prefix}:array`;

      if (target.product !== "redis" || !atLeast(target.version, "8.8.0")) {
        for (const name of [
          "ARCOUNT",
          "ARLEN",
          "ARGET",
          "ARGETRANGE",
          "ARMGET",
          "ARSET",
          "ARMSET",
          "ARDEL",
          "ARDELRANGE",
          "ARINSERT",
          "ARNEXT",
          "ARSEEK",
          "ARRING",
          "ARLASTITEMS",
          "AROP",
          "ARGREP",
          "ARINFO",
        ])
          yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.arset(key, 0, ["v"]))).toMatchObject({
          _tag: "ServerError",
        });
        return;
      }

      expect(yield* redis.arcount(key)).toBe(0n);
      expect(yield* redis.arset(key, 2, ["a", "b"])).toBe(2n);
      expect(yield* redis.arlen(key)).toBe(4n);
      expect(yield* redis.arcount(key)).toBe(2n);
      expect(yield* redis.arget(key, 0)).toEqual(Option.none());
      expect(
        yield* redis.armset(key, [
          [0, "1"],
          [1, "2"],
        ]),
      ).toBe(2n);
      expect(yield* redis.argetrange(key, 0, 3)).toEqual([
        Option.some(bytes("1")),
        Option.some(bytes("2")),
        Option.some(bytes("a")),
        Option.some(bytes("b")),
      ]);
      expect(yield* redis.armget(key, [3, 99])).toEqual([Option.some(bytes("b")), Option.none()]);
      expect(yield* redis.argrep(key, "-", "+", [{ type: "EXACT", value: "a" }])).toEqual([2n]);
      expect(yield* redis.argrepWithValues(key, "-", "+", [{ type: "GLOB", value: "a*" }])).toEqual(
        [[2n, bytes("a")]],
      );
      expect(yield* redis.arop(key, 0, 3, "SUM")).toEqual(Option.some("3"));
      expect(yield* redis.aropInteger(key, 0, 3, "USED")).toEqual(Option.some(4n));
      expect(yield* redis.aropMatch(key, 0, 3, "a")).toBe(1n);
      expect(yield* redis.ardel(key, [3])).toBe(1n);
      expect(yield* redis.ardelrange(key, [[2, 2]])).toBe(1n);
      expect(yield* redis.arseek(key, 10)).toBe(true);
      expect(yield* redis.arnext(key)).toEqual(Option.some(10n));
      expect(yield* redis.arinsert(key, ["x", "y"])).toBe(11n);
      expect(yield* redis.arlastitems(key, 2)).toEqual([
        Option.some(bytes("x")),
        Option.some(bytes("y")),
      ]);
      expect(yield* redis.arlastitems(key, -1)).toEqual([]);
      expect(yield* redis.arring(`${key}:ring`, 2, ["a", "b", "c"])).toBe(0n);
      expect((yield* redis.arinfo(key)).count).toBe(4n);
      expect((yield* redis.arinfo(key, true)).details).toMatchObject({ _tag: "Some" });

      // This cursor crosses signed int64; both RESP2 decimal bulk and RESP3 big-number replies stay exact.
      const high = 9223372036854775810n;
      expect(yield* redis.arseek(key, high)).toBe(true);
      expect(yield* redis.arinsert(key, [new Uint8Array([0, 255])])).toBe(high);
      expect(yield* redis.arget(key, high)).toEqual(Option.some(new Uint8Array([0, 255])));
      expect(yield* redis.arnext(key)).toEqual(Option.some(high + 1n));
      expect(yield* redis.arseek(key, 18446744073709551615n)).toBe(true);
      expect(yield* redis.arnext(key)).toEqual(Option.none());
    }),
);
