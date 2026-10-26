import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Commands, PayloadCodec, makeRedisSessions } from "#/index";
import { layer } from "#/node";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-JSON: $fixture.id $protocol paths, Schema and typed mutations",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, server, observed, config } = yield* moduleBackend(fixture, protocol);
      const key = `${prefix}:doc`;
      const document = PayloadCodec.json(
        Schema.Struct({
          name: Schema.String,
          array: Schema.Array(Schema.Number),
          n: Schema.Number,
          flag: Schema.Boolean,
        }),
      );
      const initial = { name: "Ada", array: [1, 2], n: 2, flag: true };
      expect(yield* redis.jsonSetWith(key, "$", initial, document)).toBe(true);
      expect(yield* redis.jsonGetWith(key, document)).toEqual(Option.some(initial));
      expect(yield* redis.jsonSet(key, "$", "null", { condition: "NX" })).toBe(false);
      expect(yield* redis.jsonGetWith(`${prefix}:missing`, document)).toEqual(Option.none());
      expect(yield* redis.jsonType(key)).toEqual(Option.some([Option.some("object")]));
      expect(yield* redis.jsonTypeLegacy(key)).toEqual(Option.some("object"));
      expect(yield* redis.jsonObjlen(key)).toEqual(Option.some([Option.some(4n)]));
      expect(yield* redis.jsonObjlenLegacy(key)).toEqual(Option.some(4n));
      expect(yield* redis.jsonArrlen(key, "$.array")).toEqual(Option.some([Option.some(2n)]));
      expect(yield* redis.jsonArrlenLegacy(key, ".array")).toEqual(Option.some(2n));
      expect(yield* redis.jsonArrlen(key, "$.missing")).toEqual(Option.some([]));
      expect(yield* redis.jsonArrlen(key, "$.name")).toEqual(Option.some([Option.none()]));

      expect(yield* redis.jsonArrappend(key, "$.array", ["3"])).toEqual(
        Option.some([Option.some(3n)]),
      );
      expect(yield* redis.jsonArrinsert(key, "$.array", 0, ["0"])).toEqual(
        Option.some([Option.some(4n)]),
      );
      expect(yield* redis.jsonArrindex(key, "$.array", "2")).toEqual(
        Option.some([Option.some(2n)]),
      );
      expect(yield* redis.jsonArrtrim(key, "$.array", 1, 3)).toEqual(
        Option.some([Option.some(3n)]),
      );
      expect(yield* redis.jsonArrpop(key, "$.array")).toEqual(
        Option.some([Option.some(new TextEncoder().encode("3"))]),
      );
      expect(yield* redis.jsonNumincrby(key, "$.n", 1)).toEqual(Option.some([Option.some("3")]));
      expect(yield* redis.jsonNummultbyLegacy(key, ".n", 2)).toEqual(
        fixture.engine === "redis" && protocol === "resp3"
          ? { _tag: "Matches", values: [Option.some("6")] }
          : { _tag: "Scalar", value: Option.some("6") },
      );
      expect(yield* redis.jsonToggle(key, "$.flag")).toEqual(Option.some([Option.some(false)]));
      expect(yield* redis.jsonToggleLegacy(key, ".flag")).toEqual(Option.some(true));
      expect(yield* redis.jsonStrappend(key, "$.name", '"!"')).toEqual(
        Option.some([Option.some(4n)]),
      );
      expect(yield* redis.jsonStrlenLegacy(key, ".name")).toEqual(Option.some(4n));
      expect((yield* redis.jsonObjkeysLegacy(key))._tag).toBe("Some");
      expect((yield* redis.jsonDebugMemory(key))._tag).toBe("Some");
      expect((yield* redis.jsonDebugMemoryLegacy(key))._tag).toBe("Some");
      expect((yield* redis.jsonResp(key))._tag).not.toBe("Null");

      yield* redis.jsonMset([
        [`${prefix}:one`, "$", "1"],
        [`${prefix}:two`, "$", "null"],
      ]);
      expect(
        yield* redis.jsonMget([`${prefix}:one`, `${prefix}:two`, `${prefix}:none`], "."),
      ).toEqual([
        Option.some(new TextEncoder().encode("1")),
        Option.some(new TextEncoder().encode("null")),
        Option.none(),
      ]);
      const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));
      const committed = yield* sessions.transaction([
        Commands.jsonSet(`${prefix}:batch`, "$", '"ok"'),
      ]);
      expect(committed._tag).toBe("Committed");
      expect(yield* redis.jsonGetWith(`${prefix}:batch`, PayloadCodec.json(Schema.String))).toEqual(
        Option.some("ok"),
      );
      if (fixture.engine === "redis" && protocol === "resp3")
        expect((yield* redis.jsonGetExpanded(key))._tag).toBe("Some");
      else if (fixture.engine === "valkey")
        expect(yield* Effect.flip(redis.jsonGetExpanded(key))).toMatchObject({
          _tag: "ReplyError",
        });
      else
        expect(yield* Effect.flip(redis.jsonGetExpanded(key))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });

      yield* redis.jsonSet(`${prefix}:trim`, "$", "[0,1,2,3]");
      expect(yield* redis.jsonArrtrim(`${prefix}:trim`, "$", 1, -1)).toEqual(
        Option.some([Option.some(fixture.engine === "valkey" ? 0n : 3n)]),
      );
      expect(yield* redis.jsonClear(key, "$.array")).toBe(1n);
      expect(yield* redis.jsonForget(key, "$.name")).toBe(1n);
      expect(yield* redis.jsonDel(key)).toBe(1n);
      yield* recordFixture(`module-json-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "schema",
          "null-absence",
          "legacy-jsonpath",
          "mutations",
          "protocol-numbers",
          "expanded-dialect",
        ],
      });
    }),
  90_000,
);
