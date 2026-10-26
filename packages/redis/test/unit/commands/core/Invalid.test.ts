import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { BitfieldOperation } from "#/commands/bitmaps/Bitfield";
import { Commands } from "#/index";
import type { Command, GeoOrigin, SortedRange, SortedRangeWithScores } from "#/index";

const invalid: ReadonlyArray<Command<unknown>> = [
  Commands.lpos("k", "v", { rank: 0 }),
  Commands.lmpop(["a"], "LEFT", 0),
  Commands.lmovem("a", "b", "LEFT", "RIGHT", { count: -1, ordering: "OBO", selection: "COUNT" }),
  Commands.spopCount("k", -1),
  Commands.sunioncard(["k"], { limit: -1 }),
  Commands.zadd("k", [[1, "v"]], { condition: "NX", comparison: "GT" }),
  Commands.zadd("k", [[NaN, "v"]]),
  Commands.zinter(["a", "b"], { weights: [1] }),
  Commands.zintercard(["a"], -1),
  Commands.zmpop(["a"], "MIN", 0),
  Commands.zrange("k", {
    by: "rank",
    start: 0,
    end: 1,
    limit: { offset: 0, count: 2 },
  } as unknown as SortedRange),
  Commands.zcount("k", "not-a-number", 1),
  Commands.zrangeWithScores("k", {
    by: "lex",
    min: "-",
    max: "+",
  } as unknown as SortedRangeWithScores),
  Commands.bitop("NOT", "out", ["a", "b"]),
  Commands.bitpos("k", 1, { start: 0, unit: "BIT" }),
  Commands.bitfield("k", [
    {
      operation: "GET",
      encoding: { signed: false, bits: 64 },
      offset: 0,
    } as unknown as BitfieldOperation,
  ]),
  Commands.bitfield("k", [
    {
      operation: "GET",
      encoding: { signed: true, bits: 0 },
      offset: 0,
    } as unknown as BitfieldOperation,
  ]),
  Commands.bitfield("k", [{ operation: "GET", encoding: { signed: true, bits: 8 }, offset: -1 }]),
  Commands.geoadd("k", [{ longitude: 181, latitude: 0, member: "v" }]),
  Commands.geoadd("k", [{ longitude: 0, latitude: NaN, member: "v" }]),
  Commands.geosearch("k", { origin: { member: "m" }, area: { radius: -1, unit: "km" } }),
  Commands.georadiusWith("k", null as unknown as GeoOrigin, 1, "m", {}),
  Commands.arset("k", -1, ["v"]),
  Commands.arseek("k", 18446744073709551616n),
  Commands.arset("k", Number.MAX_SAFE_INTEGER + 1, ["v"]),
  Commands.arring("k", 0, ["v"]),
  Commands.restore("k", 0, "bytes", { idleTime: 1, frequency: 1 }),
  Commands.copy("a", "b", { database: -1 }),
  Commands.msetex([["k", "v"]], { expiry: { type: "PX", value: 0 } }),
  Commands.hsetex("k", [["f", "v"]], { expiry: { type: "EX", value: Infinity } }),
];

it.effect.each(invalid)("CORE-INPUT: invalid grammar/range fails before admission %#", (command) =>
  Effect.gen(function* () {
    expect(yield* Effect.flip(command.prepare)).toMatchObject({
      _tag: "CommandInputError",
      delivery: "unsent",
    });
  }),
);
