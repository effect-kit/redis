import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-HASHES: $target.fixture $protocol fields, expiry and ordered binary pairs",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const key = `${prefix}:hash`;
      const binary = new Uint8Array([0, 255]);

      expect(
        yield* redis.hset(key, [
          ["a", "one"],
          [binary, binary],
        ]),
      ).toBe(2n);
      expect(yield* redis.hlen(key)).toBe(2n);
      expect(yield* redis.hget(key, "a")).toEqual(Option.some(bytes("one")));
      expect(yield* redis.hgetText(key, "a")).toEqual(Option.some("one"));
      expect(yield* redis.hget(key, binary)).toEqual(Option.some(binary));
      expect(yield* redis.hmget(key, ["a", "missing"])).toEqual([
        Option.some(bytes("one")),
        Option.none(),
      ]);
      expect(yield* redis.hexists(key, "missing")).toBe(false);
      expect(yield* redis.hstrlen(key, "a")).toBe(3n);
      expect(yield* redis.hkeys(key)).toHaveLength(2);
      expect(yield* redis.hvals(key)).toHaveLength(2);
      expect(yield* redis.hgetall(key)).toEqual(
        expect.arrayContaining([
          [bytes("a"), bytes("one")],
          [binary, binary],
        ]),
      );
      yield* redis.hmset(key, [["b", "two"]]);
      expect(yield* redis.hsetnx(key, "b", "no")).toBe(false);
      expect(yield* redis.hincrby(key, "counter", 9007199254740993n)).toBe(9007199254740993n);
      expect(yield* redis.hincrbyfloat(key, "float", 0.5)).toBe("0.5");
      expect(yield* exchange(oracle, ["HGET", key, "counter"])).toEqual({
        _tag: "BlobString",
        value: bytes("9007199254740993"),
      });
      expect(yield* redis.hrandfield(key)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.hrandfieldCount(key, -3)).toHaveLength(3);
      expect(yield* redis.hrandfieldWithValues(key, 2)).toHaveLength(2);
      expect(yield* redis.hdel(key, ["b", "missing"])).toBe(1n);

      const fieldExpiry =
        (target.product === "redis" && atLeast(target.version, "7.4.0")) ||
        (target.product === "valkey" && atLeast(target.version, "9.0.0"));
      if (fieldExpiry) {
        expect(yield* redis.httl(key, ["a", "missing"])).toEqual([-1n, -2n]);
        expect(yield* redis.hpttl(key, ["a", "missing"])).toEqual([-1n, -2n]);
        expect(yield* redis.hexpire(key, 60, ["a", "missing"], "NX")).toEqual([1n, -2n]);
        expect((yield* redis.hpttl(key, ["a"]))[0]).toBeGreaterThan(0n);
        expect(yield* redis.hpexpire(key, 120000, ["a"], "GT")).toEqual([1n]);
        expect((yield* redis.hexpiretime(key, ["a"]))[0]).toBeGreaterThan(0n);
        expect((yield* redis.hpexpiretime(key, ["a"]))[0]).toBeGreaterThan(0n);
        expect(yield* redis.hexpireat(key, 4102444800n, ["a"])).toEqual([1n]);
        expect(yield* redis.hpexpireat(key, 4102444800000n, ["a"])).toEqual([1n]);
        expect(yield* redis.hpersist(key, ["a", "missing"])).toEqual([1n, -2n]);
      } else {
        for (const name of [
          "HEXPIRE",
          "HPEXPIRE",
          "HEXPIREAT",
          "HPEXPIREAT",
          "HTTL",
          "HPTTL",
          "HEXPIRETIME",
          "HPEXPIRETIME",
          "HPERSIST",
        ])
          yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.hexpire(key, 60, ["a"]))).toMatchObject({
          _tag: "ServerError",
        });
      }

      const setExpiry =
        target.product === "redis"
          ? atLeast(target.version, "8.0.0")
          : atLeast(target.version, "9.0.0");
      if (setExpiry) {
        expect(
          yield* redis.hsetex(key, [["expiring", "v"]], {
            condition: "FNX",
            expiry: { type: "PX", value: 60000 },
          }),
        ).toBe(true);
        expect(yield* redis.hsetex(key, [["expiring", "no"]], { condition: "FNX" })).toBe(false);
        if (target.product === "valkey")
          expect(yield* redis.hsetex(`${key}:new`, [["f", "v"]], { keyCondition: "NX" })).toBe(
            true,
          );
        else
          expect(
            yield* Effect.flip(redis.hsetex(`${key}:new`, [["f", "v"]], { keyCondition: "NX" })),
          ).toMatchObject({ _tag: "ServerError" });
      } else {
        yield* absent(oracle, "HSETEX");
        expect(yield* Effect.flip(redis.hsetex(key, [["f", "v"]]))).toMatchObject({
          _tag: "ServerError",
        });
      }

      const getExpiry =
        target.product === "redis"
          ? atLeast(target.version, "8.0.0")
          : atLeast(target.version, "9.1.0");
      if (getExpiry) {
        expect(yield* redis.hgetex(key, ["a", "missing"], { type: "PERSIST" })).toEqual([
          Option.some(bytes("one")),
          Option.none(),
        ]);
        expect(yield* redis.hgetdel(key, ["a", "missing"])).toEqual([
          Option.some(bytes("one")),
          Option.none(),
        ]);
        expect(yield* redis.hexists(key, "a")).toBe(false);
      } else {
        for (const name of ["HGETEX", "HGETDEL"]) yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.hgetex(key, ["a"]))).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.hgetdel(key, ["a"]))).toMatchObject({
          _tag: "ServerError",
        });
      }

      yield* redis.set(`${key}:wrong`, "string");
      expect(yield* Effect.flip(redis.hget(`${key}:wrong`, "a"))).toMatchObject({
        _tag: "ServerError",
        code: "WRONGTYPE",
      });
    }),
);
