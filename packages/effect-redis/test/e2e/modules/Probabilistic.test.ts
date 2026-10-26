import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-BLOOM: $fixture.id $protocol binary membership and dump/load",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, server, observed } = yield* moduleBackend(fixture, protocol);
      const key = `${prefix}:bloom`;
      const value = new Uint8Array([0, 255, 128]);
      yield* redis.bfReserve(key, 0.001, 100);
      expect(yield* redis.bfExists(key, value)).toBe(false);
      expect(yield* redis.bfAdd(key, value)).toBe(true);
      expect(yield* redis.bfAdd(key, value)).toBe(false);
      expect(yield* redis.bfMexists(key, [value, value])).toEqual([true, true]);
      expect(yield* redis.bfMadd(key, [value, value])).toEqual([false, false]);
      expect(yield* redis.bfInsert(key, [value], { noCreate: true })).toEqual([false]);
      expect(yield* redis.bfCard(key)).toBe(1n);
      expect((yield* redis.bfInfo(key)).length).toBeGreaterThan(0);

      if (fixture.engine === "redis") {
        let cursor = 0n;
        for (let page = 0; page < 32; page++) {
          const chunk = yield* redis.bfScandump(key, cursor);
          if (chunk.cursor !== 0n && Option.isSome(chunk.chunk))
            yield* redis.bfLoadchunk(`${prefix}:copy`, chunk.cursor, chunk.chunk.value);
          cursor = chunk.cursor;
          if (cursor === 0n) break;
          if (page === 31) return yield* Effect.die("Nonterminating Bloom dump cursor");
        }
        expect(yield* redis.bfExists(`${prefix}:copy`, value)).toBe(true);
      } else
        expect(yield* Effect.flip(redis.bfScandump(key, 0))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });

      yield* recordFixture(`module-bloom-${fixture.id}-${protocol}`, {
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        protocol,
        checks: ["binary", "membership", "positional-flags", "dump-availability"],
      });
    }),
  90_000,
);

it.live.each(moduleCases)(
  "MODULE-STATISTICS: $fixture.id $protocol Cuckoo/CMS/TopK/t-digest contracts",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* moduleBackend(fixture, protocol);
      const cf = `${prefix}:cf`;
      if (fixture.engine === "valkey") {
        expect(yield* Effect.flip(redis.cfReserve(cf, 100))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
        expect(yield* Effect.flip(redis.cmsInitbydim(`${prefix}:cms`, 100, 5))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
        expect(yield* Effect.flip(redis.topkReserve(`${prefix}:top`, 3))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
        expect(yield* Effect.flip(redis.tdigestCreate(`${prefix}:td`))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
        return;
      }

      yield* redis.cfReserve(cf, 100, { bucketSize: 2, expansion: 0 });
      expect(yield* redis.cfExists(cf, "a")).toBe(false);
      expect(yield* redis.cfAdd(cf, "a")).toBe(true);
      expect(yield* redis.cfAdd(cf, "a")).toBe(true);
      expect(yield* redis.cfCount(cf, "a")).toBe(2n);
      expect(yield* redis.cfAddnx(cf, "a")).toBe(false);
      expect(yield* redis.cfInsertnx(cf, ["a"], { noCreate: true })).toEqual([0]);
      expect(yield* redis.cfMexists(cf, ["a", "a"])).toEqual([true, true]);
      expect(yield* redis.cfDel(cf, "a")).toBe(true);
      expect(yield* redis.cfCount(cf, "a")).toBe(1n);

      for (const name of ["left", "right", "out"])
        yield* redis.cmsInitbydim(`${prefix}:${name}`, 100, 5);
      expect(
        yield* redis.cmsIncrby(`${prefix}:left`, [
          ["a", 3],
          ["b", 2],
        ]),
      ).toEqual([3n, 2n]);
      yield* redis.cmsIncrby(`${prefix}:right`, [["a", 1]]);
      yield* redis.cmsMerge(`${prefix}:out`, [`${prefix}:left`, `${prefix}:right`], {
        weights: [2, -1],
      });
      expect(yield* redis.cmsQuery(`${prefix}:out`, ["a", "b"])).toEqual([5n, 4n]);
      yield* redis.cmsInitbyprob(`${prefix}:prob`, 0.01, 0.01);

      yield* redis.topkReserve(`${prefix}:top`, 3, { width: 100, depth: 5, decay: 1 });
      expect(yield* redis.topkAdd(`${prefix}:top`, ["a"])).toEqual([Option.none()]);
      expect(yield* redis.topkQuery(`${prefix}:top`, ["a"])).toEqual([true]);
      yield* redis.topkIncrby(`${prefix}:top`, [["a", 2]]);
      expect(yield* redis.topkListWithCount(`${prefix}:top`)).toContainEqual([
        new TextEncoder().encode("a"),
        3n,
      ]);

      yield* redis.tdigestCreate(`${prefix}:td`, { compression: 100 });
      expect(yield* redis.tdigestMin(`${prefix}:td`)).toBeNaN();
      yield* redis.tdigestAdd(`${prefix}:td`, [1, 2, 3, 4, 5]);
      expect(yield* redis.tdigestMin(`${prefix}:td`)).toBe(1);
      expect(yield* redis.tdigestMax(`${prefix}:td`)).toBe(5);
      expect((yield* redis.tdigestQuantile(`${prefix}:td`, [0.5]))[0]).toBeCloseTo(3, 1);
      expect(yield* redis.tdigestRank(`${prefix}:td`, [3])).toEqual([2n]);
      expect(yield* redis.tdigestByrank(`${prefix}:td`, [0])).toEqual([1]);
      yield* redis.tdigestMerge(`${prefix}:merged`, [`${prefix}:td`], {
        compression: 100,
        override: true,
      });
      expect(yield* redis.tdigestTrimmedMean(`${prefix}:merged`, 0, 1)).toBeCloseTo(3, 1);
      yield* redis.tdigestReset(`${prefix}:td`);
      expect(yield* redis.tdigestMax(`${prefix}:td`)).toBeNaN();
    }),
  90_000,
);
