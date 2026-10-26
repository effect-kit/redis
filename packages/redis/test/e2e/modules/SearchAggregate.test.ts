import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import { makeRedisSearch, makeRedisSessions } from "#/index";
import { layer } from "#/node";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { waitForSearchCount } from "#test/support/modules/SearchReady";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-FT-AGG: $fixture.id $protocol ordered pipelines and owned cursors",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, config, observed, server } = yield* moduleBackend(fixture, protocol);
      const index = `${prefix}:index`;
      yield* redis.ftCreate(
        index,
        [
          { field: "title", type: "TAG" },
          { field: "price", type: "NUMERIC" },
        ],
        { on: "HASH", prefixes: [`${prefix}:doc:`] },
      );
      yield* redis.hset(`${prefix}:doc:one`, [
        ["title", "hello"],
        ["price", "2"],
      ]);
      yield* redis.hset(`${prefix}:doc:two`, [
        ["title", "hello"],
        ["price", "3"],
      ]);
      yield* waitForSearchCount(redis, index, 2n, "@title:{hello}");
      const options = {
        dialect: 2,
        steps: [{ _tag: "Load" as const, fields: [{ field: "@title" }, { field: "@price" }] }],
      };
      const plain = yield* redis.ftAggregate(index, "@title:{hello}", options);
      expect(plain.total).toBe(fixture.id === "redis-stack" && protocol === "resp2" ? 1n : 2n);
      expect(plain.rows.length).toBe(2);
      const grouped = yield* redis.ftAggregate(index, "@title:{hello}", {
        dialect: 2,
        steps: [
          { _tag: "Load", fields: [{ field: "@price" }, { field: "@title" }] },
          { _tag: "Apply", expression: "@price * 2", as: "doubled" },
          { _tag: "Filter", expression: "@doubled >= 4" },
          {
            _tag: "GroupBy",
            fields: ["@title"],
            reducers: [{ function: "SUM", args: ["@doubled"], as: "total" }],
          },
          { _tag: "SortBy", fields: [{ field: "@total", order: "DESC" }] },
          { _tag: "Limit", offset: 0, count: 1 },
        ],
      });
      expect(grouped.rows.length).toBe(1);

      const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));
      const search = makeRedisSearch(sessions);
      if (fixture.engine === "valkey") {
        expect(
          yield* Effect.flip(
            redis.ftAggregateWithCursor(index, "@title:{hello}", options, { count: 1 }),
          ),
        ).toMatchObject({ _tag: "ServerError" });
      } else {
        const first = yield* redis.ftAggregateWithCursor(index, "@title:{hello}", options, {
          count: 1,
          maxIdleMillis: 10000,
        });
        expect(first.page.rows.length).toBe(1);
        expect(first.cursor).toBeGreaterThan(0n);
        const next = yield* redis.ftCursorRead(index, first.cursor, 1);
        expect(next.page.rows.length).toBe(1);
        if (next.cursor !== 0n) yield* redis.ftCursorDel(index, next.cursor);
        const full = yield* Stream.runCollect(
          search.aggregate(index, "@title:{hello}", options, { count: 1 }),
        );
        expect(full.length).toBe(2);
        const early = yield* search
          .aggregate(index, "@title:{hello}", options, { count: 1 })
          .pipe(Stream.take(1), Stream.runCollect);
        expect(early.length).toBe(1);
        const profile = yield* redis.ftProfileAggregate(index, "@title:{hello}", options);
        expect(profile.result.rows.length).toBe(2);
      }
      yield* redis.ftDropindex(index);
      yield* recordFixture(`module-search-aggregate-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "ordered-pipeline",
          "reducers",
          "cursor-read-delete",
          "scoped-early-exit",
          "profile",
        ],
      });
    }),
  90_000,
);
