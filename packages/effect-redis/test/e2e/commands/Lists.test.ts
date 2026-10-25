import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-LISTS: $target.fixture $protocol count variants and atomic movement",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const source = `${prefix}:source`;
      const destination = `${prefix}:destination`;

      expect(yield* redis.lpop(source)).toEqual(Option.none());
      expect(yield* redis.lpopCount(source, 2)).toEqual(Option.none());
      expect(yield* redis.lpushx(source, ["missing"])).toBe(0n);
      expect(yield* redis.rpushx(source, ["missing"])).toBe(0n);
      expect(yield* redis.rpush(source, ["a", "b", "a"])).toBe(3n);
      expect(yield* redis.lpush(source, ["zero"])).toBe(4n);
      expect(yield* redis.llen(source)).toBe(4n);
      expect(yield* redis.lindex(source, -1)).toEqual(Option.some(bytes("a")));
      expect(yield* redis.lpos(source, "a")).toEqual(Option.some(1n));
      expect(yield* redis.lposCount(source, "a", 0)).toEqual([1n, 3n]);
      expect(yield* redis.linsert(source, "AFTER", "b", "c")).toBe(5n);
      yield* redis.lset(source, 0, "start");
      expect(yield* redis.lrem(source, -1, "a")).toBe(1n);
      yield* redis.ltrim(source, 0, 2);
      expect(yield* redis.lrange(source, 0, -1)).toEqual([bytes("start"), bytes("a"), bytes("b")]);
      expect(yield* exchange(oracle, ["LRANGE", source, "0", "-1"])).toMatchObject({
        _tag: "Array",
        values: [{ value: bytes("start") }, { value: bytes("a") }, { value: bytes("b") }],
      });
      expect(yield* redis.lmove(source, destination, "RIGHT", "LEFT")).toEqual(
        Option.some(bytes("b")),
      );
      expect(yield* redis.rpoplpush(destination, source)).toEqual(Option.some(bytes("b")));
      expect(yield* redis.lpopCount(source, 2)).toEqual(Option.some([bytes("b"), bytes("start")]));
      expect(yield* redis.rpop(source)).toEqual(Option.some(bytes("a")));
      yield* redis.rpush(source, ["x", "y"]);
      expect(yield* redis.rpopCount(source, 2)).toEqual(Option.some([bytes("y"), bytes("x")]));

      yield* redis.rpush(source, ["a", "b"]);
      const multi = target.product === "valkey" || atLeast(target.version, "7.0.0");
      if (multi)
        expect(yield* redis.lmpop([`${prefix}:missing`, source], "LEFT", 2)).toEqual(
          Option.some([bytes(source), [bytes("a"), bytes("b")]]),
        );
      else {
        yield* absent(oracle, "LMPOP");
        expect(yield* Effect.flip(redis.lmpop([source], "LEFT"))).toMatchObject({
          _tag: "ServerError",
        });
      }

      if (target.product === "redis" && atLeast(target.version, "8.10.0")) {
        yield* redis.rpush(source, ["first", "second"]);
        expect(
          yield* redis.lmovem(source, destination, "LEFT", "RIGHT", {
            selection: "EXACTLY",
            count: 3,
            ordering: "BULK",
          }),
        ).toEqual(Option.none());
        expect(
          yield* redis.lmovem(source, destination, "LEFT", "RIGHT", {
            selection: "COUNT",
            count: 2,
            ordering: "BULK",
          }),
        ).toEqual(Option.some([bytes("first"), bytes("second")]));
      } else {
        yield* absent(oracle, "LMOVEM");
        expect(
          yield* Effect.flip(redis.lmovem(source, destination, "LEFT", "RIGHT")),
        ).toMatchObject({ _tag: "ServerError" });
      }

      yield* redis.set(`${source}:wrong`, "string");
      expect(yield* Effect.flip(redis.llen(`${source}:wrong`))).toMatchObject({
        _tag: "ServerError",
        code: "WRONGTYPE",
      });
    }),
);
