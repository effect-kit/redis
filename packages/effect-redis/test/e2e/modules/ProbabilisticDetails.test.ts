import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { moduleBackend, moduleCases } from "#test/support/modules/Backend";

it.live.each(moduleCases)(
  "MODULE-STAT-DETAIL: $fixture.id $protocol introspection, Cuckoo restore and distribution boundaries",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* moduleBackend(fixture, protocol);
      const bloom = `${prefix}:bf`;
      yield* redis.bfReserve(bloom, 0.001, 100, { nonScaling: true });
      expect(yield* redis.bfInfoValue(bloom, "CAPACITY")).toBeGreaterThanOrEqual(100n);
      if (fixture.engine === "valkey") {
        expect(yield* Effect.flip(redis.cfCompact(`${prefix}:cf`))).toMatchObject({
          _tag: "ServerError",
        });
        return;
      }
      expect(yield* redis.bfInfoExpansion(bloom)).toEqual(Option.none());
      expect((yield* redis.bfDebug(bloom)).length).toBeGreaterThan(0);
      const cf = `${prefix}:cf`;
      yield* redis.cfReserve(cf, 100);
      expect(yield* redis.cfInsert(cf, ["a", "b"], { noCreate: true })).toEqual([1, 1]);
      expect((yield* redis.cfInfo(cf)).length).toBeGreaterThan(0);
      expect((yield* redis.cfDebug(cf)).length).toBeGreaterThan(0);
      yield* redis.cfCompact(cf);
      let cursor = 0n;
      for (let page = 0; page < 32; page++) {
        const receipt = yield* redis.cfScandump(cf, cursor);
        if (receipt.cursor !== 0n && Option.isSome(receipt.chunk))
          yield* redis.cfLoadchunk(`${prefix}:copy`, receipt.cursor, receipt.chunk.value);
        cursor = receipt.cursor;
        if (cursor === 0n) break;
        if (page === 31) return yield* Effect.die(new Error("Cuckoo dump did not terminate"));
      }
      expect(yield* redis.cfMexists(`${prefix}:copy`, ["a", "b"])).toEqual([true, true]);
      yield* redis.cmsInitbydim(`${prefix}:cms`, 100, 5);
      expect((yield* redis.cmsInfo(`${prefix}:cms`)).length).toBeGreaterThan(0);
      yield* redis.topkReserve(`${prefix}:top`, 2);
      yield* redis.topkAdd(`${prefix}:top`, ["a"]);
      expect(yield* redis.topkCount(`${prefix}:top`, ["a"])).toEqual([1n]);
      expect(yield* redis.topkList(`${prefix}:top`)).toContainEqual(new TextEncoder().encode("a"));
      expect((yield* redis.topkInfo(`${prefix}:top`)).length).toBeGreaterThan(0);
      const td = `${prefix}:td`;
      yield* redis.tdigestCreate(td);
      yield* redis.tdigestAdd(td, [1, 2, 3, 4, 5]);
      expect((yield* redis.tdigestInfo(td)).length).toBeGreaterThan(0);
      expect(yield* redis.tdigestRevrank(td, [3])).toEqual([2n]);
      expect(yield* redis.tdigestByrevrank(td, [0])).toEqual([5]);
      expect((yield* redis.tdigestCdf(td, [3]))[0]).toBeCloseTo(0.5, 1);
      expect(yield* redis.tdigestByrank(td, [5])).toEqual([Infinity]);
      expect(yield* redis.tdigestByrevrank(td, [5])).toEqual([-Infinity]);
    }),
  90_000,
);
