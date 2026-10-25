import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-STRINGS: $target.fixture $protocol ordinary string commands and availability",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const a = `${prefix}:a`;
      const b = `${prefix}:b`;
      const number = `${prefix}:number`;

      yield* redis.mset([
        [a, "hello"],
        [b, "world"],
      ]);
      expect(yield* redis.mget([a, b, `${prefix}:missing`])).toEqual([
        Option.some(bytes("hello")),
        Option.some(bytes("world")),
        Option.none(),
      ]);
      expect(yield* redis.append(a, "!")).toBe(6n);
      expect(yield* exchange(oracle, ["GET", a])).toEqual({
        _tag: "BlobString",
        value: bytes("hello!"),
      });
      expect(yield* redis.strlen(a)).toBe(6n);
      expect(yield* redis.getrange(a, -2, -1)).toEqual(bytes("o!"));
      expect(yield* redis.substr(a, 0, 1)).toEqual(bytes("he"));
      expect(yield* redis.setrange(a, 0, "H")).toBe(6n);
      expect(yield* redis.getset(a, "next")).toEqual(Option.some(bytes("Hello!")));
      expect(yield* redis.getdel(a)).toEqual(Option.some(bytes("next")));
      expect(yield* redis.getdel(a)).toEqual(Option.none());

      expect(
        yield* redis.msetnx([
          [a, "first"],
          [b, "blocked"],
        ]),
      ).toBe(false);
      expect(yield* redis.get(a)).toEqual(Option.none());
      expect(yield* redis.setnx(a, "first")).toBe(true);
      expect(yield* redis.setnx(a, "second")).toBe(false);
      yield* redis.setex(a, 60, "seconds");
      yield* redis.psetex(b, 60000, "milliseconds");
      expect(yield* redis.getex(a, { type: "PERSIST" })).toEqual(Option.some(bytes("seconds")));
      expect(yield* exchange(oracle, ["TTL", a])).toEqual({ _tag: "Integer", value: -1n });

      expect(yield* redis.incrby(number, 9007199254740993n)).toBe(9007199254740993n);
      expect(yield* redis.decr(number)).toBe(9007199254740992n);
      expect(yield* redis.decrby(number, 2)).toBe(9007199254740990n);
      expect(yield* exchange(oracle, ["GET", number])).toEqual({
        _tag: "BlobString",
        value: bytes("9007199254740990"),
      });
      expect(yield* redis.incrbyfloat(`${number}:float`, 0.5)).toBe("0.5");

      yield* redis.mset([
        [a, "abc"],
        [b, "ac"],
      ]);
      if (atLeast(target.version, "7.0.0")) {
        expect(yield* redis.lcs(a, b)).toEqual(bytes("ac"));
        expect(yield* redis.lcsLength(a, b)).toBe(2n);
        expect((yield* redis.lcsMatches(a, b, { withMatchLength: true })).length).toBe(2n);
      } else {
        yield* absent(oracle, "LCS");
        expect(yield* Effect.flip(redis.lcs(a, b))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
      }

      if (
        (target.product === "redis" && atLeast(target.version, "8.4.0")) ||
        (target.product === "valkey" && atLeast(target.version, "9.1.0"))
      ) {
        expect(
          yield* redis.msetex(
            [
              [a, "new"],
              [b, "new"],
            ],
            { condition: "XX", expiry: { type: "EX", value: 60 } },
          ),
        ).toBe(true);
      } else {
        yield* absent(oracle, "MSETEX");
        expect(yield* Effect.flip(redis.msetex([[a, "v"]]))).toMatchObject({ _tag: "ServerError" });
      }

      if (target.product === "redis" && atLeast(target.version, "8.4.0")) {
        expect(yield* redis.digest(a)).toMatchObject({ _tag: "Some" });
        expect(yield* redis.delex(a, { type: "IFEQ", value: "wrong" })).toBe(false);
        expect(yield* redis.delex(a, { type: "IFEQ", value: "new" })).toBe(true);
      } else {
        for (const name of ["DIGEST", "DELEX"]) yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.digest(a))).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.delex(a))).toMatchObject({ _tag: "ServerError" });
      }

      if (target.product === "redis" && atLeast(target.version, "8.8.0")) {
        const key = `${number}:bounded`;
        expect(yield* redis.increx(key, { increment: 3, upper: 2, saturate: true })).toEqual([
          2n,
          2n,
        ]);
        expect(yield* redis.increxFloat(`${key}:float`, { increment: 0.5 })).toEqual([
          "0.5",
          "0.5",
        ]);
      } else {
        yield* absent(oracle, "INCREX");
        expect(yield* Effect.flip(redis.increx(`${number}:bounded`))).toMatchObject({
          _tag: "ServerError",
        });
      }

      if (target.product === "valkey" && atLeast(target.version, "9.0.0")) {
        yield* redis.set(b, "delifeq");
        expect(yield* redis.delifeq(b, "delifeq")).toBe(true);
      } else {
        yield* absent(oracle, "DELIFEQ");
        expect(yield* Effect.flip(redis.delifeq(b, "ac"))).toMatchObject({ _tag: "ServerError" });
      }
    }),
);
