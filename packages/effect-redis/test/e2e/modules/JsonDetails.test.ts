import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { moduleBackend, moduleCases } from "#test/support/modules/Backend";

it.live.each(moduleCases)(
  "MODULE-JSON-DETAIL: $fixture.id $protocol merge, legacy variants and explicit formats",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* moduleBackend(fixture, protocol);
      const key = `${prefix}:doc`;
      yield* redis.jsonSet(key, "$", '{"n":2,"s":"hi","a":[1,2],"added":true}');
      const mergeKey = `${prefix}:merge`;
      yield* redis.jsonSet(mergeKey, "$", '{"remove":1}');
      if (fixture.engine === "valkey") {
        expect(yield* Effect.flip(redis.jsonMerge(mergeKey, "$", '{"remove":null}'))).toMatchObject(
          { _tag: "ServerError" },
        );
      } else {
        expect(yield* redis.jsonMerge(mergeKey, "$", '{"remove":null,"added":true}')).toBe(true);
        expect(yield* redis.jsonGet(mergeKey)).toEqual(
          Option.some(new TextEncoder().encode('{"added":true}')),
        );
      }
      expect(yield* redis.jsonObjkeys(key)).toEqual(
        Option.some([
          Option.some(["n", "s", "a", "added"].map((name) => new TextEncoder().encode(name))),
        ]),
      );
      expect(yield* redis.jsonStrlen(key, "$.s")).toEqual(Option.some([Option.some(2n)]));
      expect(yield* redis.jsonStrappendLegacy(key, ".s", '"!"')).toEqual(Option.some(3n));
      expect(yield* redis.jsonArrappendLegacy(key, ".a", ["3"])).toEqual(Option.some(3n));
      expect(yield* redis.jsonArrinsertLegacy(key, ".a", 0, ["0"])).toEqual(Option.some(4n));
      expect(yield* redis.jsonArrindexLegacy(key, ".a", "2", { start: 0, stop: 4 })).toEqual(
        Option.some(2n),
      );
      expect(yield* redis.jsonArrtrimLegacy(key, ".a", 1, 3)).toEqual(Option.some(3n));
      expect(yield* redis.jsonArrpopLegacy(key, ".a")).toEqual(
        Option.some(new TextEncoder().encode("3")),
      );
      expect(yield* redis.jsonNummultby(key, "$.n", 2)).toEqual(Option.some([Option.some("4")]));
      const powerKey = `${prefix}:power`;
      yield* redis.jsonSet(powerKey, "$", "2");
      if (fixture.engine === "valkey")
        expect(yield* Effect.flip(redis.jsonNumpowby(powerKey, "$", 2))).toMatchObject({
          _tag: "ServerError",
        });
      else {
        expect(yield* redis.jsonNumpowby(powerKey, "$", 2)).toEqual(
          Option.some([Option.some("4")]),
        );
        yield* redis.jsonNumpowbyLegacy(powerKey, ".", 0);
        expect(yield* redis.jsonGet(powerKey)).toEqual(Option.some(new TextEncoder().encode("1")));
      }
      const legacy = yield* redis.jsonNumincrbyLegacy(key, ".n", 1);
      expect(legacy).toEqual(
        fixture.engine === "redis" && protocol === "resp3"
          ? { _tag: "Matches", values: [Option.some("5")] }
          : { _tag: "Scalar", value: Option.some("5") },
      );
      expect((yield* redis.jsonDebugHelp()).length).toBeGreaterThan(0);
      const selected = yield* redis.jsonGet(key, {
        paths: ["$.n", "$.s"],
        indent: " ",
        newline: "\n",
        space: " ",
      });
      expect(Option.isSome(selected)).toBe(true);
      if (Option.isSome(selected))
        expect(JSON.parse(new TextDecoder().decode(selected.value))).toEqual({
          "$.n": [5],
          "$.s": ["hi!"],
        });
      yield* redis.set(`${prefix}:wrong`, "text");
      expect(yield* Effect.flip(redis.jsonGet(`${prefix}:wrong`))).toMatchObject({
        _tag: "ServerError",
      });
      expect(yield* Effect.flip(redis.jsonSet(key, "$.n", "invalid-json"))).toMatchObject({
        _tag: "ServerError",
      });

      if (fixture.id === "redis-modules") {
        // RedisJSON selects the first BSON document value as the JSON root.
        const bson = new Uint8Array([19, 0, 0, 0, 3, 0, 12, 0, 0, 0, 16, 110, 0, 1, 0, 0, 0, 0, 0]);
        expect(yield* redis.jsonSet(`${prefix}:bson`, "$", bson, { format: "BSON" })).toBe(true);
        expect(yield* redis.jsonGet(`${prefix}:bson`)).toEqual(
          Option.some(new TextEncoder().encode('{"n":1}')),
        );
        expect(yield* redis.jsonSet(`${prefix}:fp`, "$", "1.2345", { floatingPoint: "FP32" })).toBe(
          true,
        );
        if (protocol === "resp3") {
          expect(Option.isSome(yield* redis.jsonGetExpandedOneLevel(key))).toBe(true);
          expect(Option.isSome(yield* redis.jsonArrpopExpanded(key, "$.a"))).toBe(true);
        }
      }
    }),
  90_000,
);
