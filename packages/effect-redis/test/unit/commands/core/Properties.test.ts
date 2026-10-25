import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Commands } from "#/index";

const Count = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }));

it.effect.prop(
  "CORE-ROUTING: counted algebra keys exclude counts, weights and destination flags",
  [Count],
  ([count]) =>
    Effect.gen(function* () {
      const keys: [string, ...string[]] = [
        "key:0",
        ...Array.from({ length: count - 1 }, (_, index) => `key:${index + 1}`),
      ];
      const prepared = yield* Commands.zunionstore("out", keys, {
        weights: Array.from({ length: count }, () => 0.5),
        aggregate: "MAX",
      }).prepare;

      expect(prepared.tokens).toEqual([
        "ZUNIONSTORE",
        "out",
        String(count),
        ...keys,
        "WEIGHTS",
        ...Array.from({ length: count }, () => "0.5"),
        "AGGREGATE",
        "MAX",
      ]);
      expect(prepared.routing).toEqual({
        _tag: "Keys",
        keys: [
          { index: 1, access: "write" },
          ...keys.map((_, index) => ({ index: index + 3, access: "read" })),
        ],
      });
    }),
);

it.effect.prop(
  "CORE-HASHES: field vectors preserve duplicate fields and their declared cardinality",
  [Count],
  ([count]) =>
    Effect.gen(function* () {
      const fields: [string, ...string[]] = [
        "same",
        ...Array.from({ length: count - 1 }, () => "same"),
      ];
      const prepared = yield* Commands.hpexpire("hash", 1000, fields, "NX").prepare;

      expect(prepared.tokens).toEqual([
        "HPEXPIRE",
        "hash",
        "1000",
        "NX",
        "FIELDS",
        String(count),
        ...fields,
      ]);
      expect(prepared.routing).toEqual({
        _tag: "Keys",
        keys: [{ index: 1, access: "read-write" }],
      });
    }),
);

it.effect("CORE-ROUTING: indirect SORT patterns are explicit and STORE remains a write key", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.sortStore("list", "out", {
      by: "weight:*",
      get: ["#", "value:*"],
    }).prepare;

    expect(prepared.routing).toEqual({
      _tag: "Dynamic",
      keys: [
        { index: 1, access: "read" },
        { index: 9, access: "write" },
      ],
      patterns: ["weight:*", "value:*"],
    });
  }),
);
