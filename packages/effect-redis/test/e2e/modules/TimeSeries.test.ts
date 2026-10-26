import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option } from "effect";

import { makeRedisSessions } from "#/index";
import { layer } from "#/node";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { waitForBlockedRead } from "#test/support/networking/BlockedRead";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-TS: $fixture.id $protocol samples, labels and aggregation",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, config, observed, server, oracle } = yield* moduleBackend(
        fixture,
        protocol,
      );
      const key = `${prefix}:source`;
      if (fixture.engine === "valkey") {
        expect(yield* Effect.flip(redis.tsCreate(key))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
      } else {
        yield* redis.tsCreate(key, {
          retentionMillis: 100_000,
          encoding: "UNCOMPRESSED",
          chunkSizeBytes: 128,
          duplicatePolicy: "LAST",
          labels: [
            ["suite", prefix],
            ["kind", "source"],
          ],
        });
        expect(yield* redis.tsGet(key)).toEqual(Option.none());
        expect(yield* redis.tsAdd(key, 1000n, 2)).toBe(1000n);
        expect(yield* redis.tsAdd(key, 1000n, 3, { onDuplicate: "SUM" })).toBe(1000n);
        expect(
          yield* redis.tsMadd([
            [key, 2000, 4],
            [key, 3000, 8],
          ]),
        ).toEqual([2000n, 3000n]);
        expect(yield* redis.tsGet(key, { latest: true })).toEqual(
          Option.some({ timestamp: 3000n, value: 8 }),
        );
        expect(yield* redis.tsRange(key, "-", "+")).toEqual([
          { timestamp: 1000n, value: 5 },
          { timestamp: 2000n, value: 4 },
          { timestamp: 3000n, value: 8 },
        ]);
        expect(yield* redis.tsRevrange(key, 0, 4000, { count: 1 })).toEqual([
          { timestamp: 3000n, value: 8 },
        ]);
        expect(
          yield* redis.tsRange(key, 1000, 3000, {
            filterByTimestamps: [1000, 3000],
            filterByValue: [1, 6],
          }),
        ).toEqual([{ timestamp: 1000n, value: 5 }]);
        expect(
          yield* redis.tsRange(key, 0, 3999, {
            aggregation: {
              aggregator: "sum",
              bucketMillis: 2000,
              align: 0,
              bucketTimestamp: "start",
            },
          }),
        ).toEqual([
          { timestamp: 0n, value: 5 },
          { timestamp: 2000n, value: 12 },
        ]);
        expect((yield* redis.tsInfo(key, { debug: true })).length).toBeGreaterThan(0);
        expect((yield* redis.tsQueryindex([`suite=${prefix}`])).length).toBe(1);
        expect((yield* redis.tsMget([`suite=${prefix}`], { labels: "all" }))[0]?.sample).toEqual(
          Option.some({ timestamp: 3000n, value: 8 }),
        );
        expect(
          (yield* redis.tsMget([`suite=${prefix}`], { labels: ["kind", "absent"] }))[0]?.labels,
        ).toContainEqual([new TextEncoder().encode("absent"), Option.none()]);
        expect(
          (yield* redis.tsMrange(0, 3999, [`suite=${prefix}`], {
            labels: "all",
            aggregation: { aggregator: "sum", bucketMillis: 2000 },
            groupBy: { label: "kind", reducer: "sum" },
          })).length,
        ).toBe(1);
        expect(
          (yield* redis.tsMrevrange(0, 3999, [`suite=${prefix}`], { count: 1 }))[0]?.samples[0],
        ).toEqual({ timestamp: 3000n, values: [8] });
        yield* redis.tsAlter(key, {
          retentionMillis: 200_000,
          duplicatePolicy: "MAX",
          ignore: { maxTimeDiffMillis: 0, maxValueDiff: 0 },
        });
        expect(yield* redis.tsIncrby(key, 2, { timestamp: 4000 })).toBe(4000n);
        expect(yield* redis.tsDecrby(key, 1, { timestamp: 5000 })).toBe(5000n);
        const compacted = `${prefix}:compacted`;
        yield* redis.tsCreate(compacted);
        yield* redis.tsCreaterule(key, compacted, "sum", 2000, 0);
        yield* redis.tsMadd([
          [key, 6000, 2],
          [key, 7000, 3],
          [key, 8000, 1],
        ]);
        expect((yield* redis.tsRange(compacted, "-", "+"))[0]).toEqual({
          timestamp: 6000n,
          value: 5,
        });
        yield* redis.tsDeleterule(key, compacted);
        expect(yield* redis.tsDel(key, 1000, 1000)).toBe(1n);

        if (fixture.id === "redis-modules") {
          expect((yield* redis.tsQuerylabels([`suite=${prefix}`])).length).toBe(2);
          expect(yield* redis.tsQuerylabelValues("suite", [`suite=${prefix}`])).toEqual([
            new TextEncoder().encode(prefix),
          ]);
          expect((yield* redis.tsNrange([key, compacted], 6000, 8000))[0]?.values.length).toBe(2);
          expect(
            (yield* redis.tsNrevrange([key, compacted], 6000, 8000, {
              aggregation: { aggregator: "sum", bucketMillis: 2000 },
            }))[0]?.values.length,
          ).toBe(2);
          expect(
            (yield* redis.tsRangeWithAggregations(key, 6000, 7999, {
              aggregation: { aggregators: ["sum", "count"], bucketMillis: 2000 },
            }))[0]?.values,
          ).toEqual([5, 2]);
          expect(
            (yield* redis.tsRevrangeWithAggregations(key, 6000, 7999, {
              aggregation: { aggregators: ["min", "max"], bucketMillis: 2000 },
            }))[0]?.values,
          ).toEqual([2, 3]);
          expect(yield* redis.tsRead(key, 8000, { maxCount: 1 })).toEqual([
            { timestamp: 8000n, value: 1 },
          ]);
          expect(
            (yield* redis.tsMrange(6000, 7999, [`suite=${prefix}`], {
              aggregation: { aggregators: ["sum", "count"], bucketMillis: 2000 },
              excludeEmpty: true,
            }))[0]?.samples[0]?.values,
          ).toEqual([5, 2]);
          const pivotKeys = [
            { key, aggregators: ["sum", "count"] as const },
            { key: compacted, aggregators: ["max"] as const },
          ] as const;
          const pivotOptions = { aggregation: { bucketMillis: 2000 } };
          expect(
            (yield* redis.tsNrangeWithAggregations(pivotKeys, 6000, 7999, pivotOptions))[0]?.values,
          ).toEqual([5, 2, 5]);
          expect(
            (yield* redis.tsNrevrangeWithAggregations(pivotKeys, 6000, 7999, pivotOptions))[0]
              ?.values,
          ).toEqual([5, 2, 5]);
          const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));
          const pending = yield* sessions
            .tsReadBlocking(key, 9000, { blockFor: Duration.seconds(2), minCount: 1, maxCount: 1 })
            .pipe(Effect.forkChild);
          yield* waitForBlockedRead(oracle, "ts.read");
          yield* redis.tsAdd(key, 9000, 9);
          expect(yield* Fiber.join(pending)).toEqual([{ timestamp: 9000n, value: 9 }]);
          expect(
            yield* sessions.tsReadBlocking(key, 10_000, { blockFor: Duration.millis(10) }),
          ).toEqual([]);
        } else {
          expect(yield* Effect.flip(redis.tsQuerylabels())).toMatchObject({
            _tag: "ServerError",
            code: "ERR",
          });
        }
      }

      yield* recordFixture(`module-timeseries-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "labels",
          "samples",
          "retention",
          "buckets",
          "rules",
          "blocking-read",
          "version-boundary",
        ],
      });
    }),
  90_000,
);
