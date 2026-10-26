import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { encodeFloat32 } from "#/index";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { waitForSearchCount } from "#test/support/modules/SearchReady";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-FT: $fixture.id $protocol typed indexes, search and binary vectors",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, observed, server } = yield* moduleBackend(fixture, protocol);
      const index = `${prefix}:index`;
      const vector = yield* encodeFloat32([1, 0]);
      yield* redis.ftCreate(
        index,
        [
          { field: "title", type: "TEXT" },
          { field: "price", type: "NUMERIC", sortable: true },
          { field: "tag", type: "TAG" },
          {
            field: "embedding",
            type: "VECTOR",
            algorithm: "HNSW",
            attributes: { dataType: "FLOAT32", dimensions: 2, distanceMetric: "COSINE" },
          },
        ],
        { on: "HASH", prefixes: [`${prefix}:doc:`] },
      );
      yield* redis.hset(`${prefix}:doc:one`, [
        ["title", "hello world"],
        ["price", "2"],
        ["tag", "a"],
        ["embedding", vector],
      ]);
      yield* redis.hset(`${prefix}:doc:two`, [
        ["title", "hello second"],
        ["price", "3"],
        ["tag", "b"],
        ["embedding", yield* encodeFloat32([0, 1])],
      ]);

      yield* waitForSearchCount(redis, index, 2n, "hello");
      const result = yield* redis.ftSearch(index, "hello", {
        dialect: 2,
        returnFields: [{ field: "title", as: "name" }],
        limit: { offset: 0, count: 1 },
      });
      expect(result.total).toBe(2n);
      expect(result.documents.length).toBe(1);
      expect(Option.isSome(result.documents[0]?.fields ?? Option.none())).toBe(true);
      const ids = yield* redis.ftSearch(index, "hello", { noContent: true, dialect: 2 });
      expect(ids.documents.every((document) => Option.isNone(document.fields))).toBe(true);
      expect(
        (yield* redis.ftSearch(index, "@tag:{a}", { noContent: true, dialect: 2 })).total,
      ).toBe(1n);
      expect(
        (yield* redis.ftSearch(index, "*=>[KNN 1 @embedding $vec AS distance]", {
          params: [["vec", vector]],
          dialect: 2,
          ...(fixture.engine === "valkey"
            ? { noContent: true }
            : {
                sortBy: { field: "distance", order: "ASC" as const },
                returnFields: [{ field: "distance" }],
              }),
        })).documents[0]?.id,
      ).toEqual(new TextEncoder().encode(`${prefix}:doc:one`));
      expect((yield* redis.ftInfo(index)).length).toBeGreaterThan(0);
      expect(yield* redis.ftList()).toContain(index);
      expect(
        yield* Effect.flip(redis.ftCreate(index, [{ field: "title", type: "TEXT" }])),
      ).toMatchObject({ _tag: "ServerError" });

      if (fixture.engine === "valkey") {
        expect(
          yield* Effect.flip(redis.ftSearch(index, "hello", { withScores: true })),
        ).toMatchObject({ _tag: "ServerError" });
      } else {
        const scored = yield* redis.ftSearch(index, "hello", {
          withScores: true,
          explainScore: true,
          withPayloads: true,
          withSortKeys: true,
          sortBy: { field: "price", order: "ASC" },
          dialect: 2,
          filters: [{ field: "price", min: 1, max: 4 }],
        });
        expect(Option.isSome(scored.documents[0]?.score ?? Option.none())).toBe(true);
        expect(scored.documents[0]?.payload).toEqual(Option.none());
        expect(scored.documents[0]?.sortKey).toEqual(Option.some(new TextEncoder().encode("#2")));
        expect((yield* redis.ftExplain(index, "hello", 2)).length).toBeGreaterThan(0);
        expect((yield* redis.ftExplaincli(index, "hello", 2)).length).toBeGreaterThan(0);
        const profile = yield* redis.ftProfileSearch(
          index,
          "hello",
          { dialect: 2 },
          { limited: true },
        );
        expect(profile.result.total).toBe(2n);
        expect(profile.profile._tag).not.toBe("Null");
        yield* redis.ftAlter(index, [{ field: "later", type: "TAG" }]);
        const jsonIndex = `${prefix}:json`;
        yield* redis.ftCreate(jsonIndex, [{ field: "$.title", as: "title", type: "TEXT" }], {
          on: "JSON",
          prefixes: [`${prefix}:jsondoc:`],
        });
        yield* redis.jsonSet(`${prefix}:jsondoc:one`, "$", '{"title":"hello"}');
        yield* waitForSearchCount(redis, jsonIndex, 1n, "hello");
        expect((yield* redis.ftSearch(jsonIndex, "hello", { dialect: 2 })).total).toBe(1n);
        yield* redis.ftDropindex(jsonIndex);
      }
      yield* redis.ftDropindex(index);
      yield* recordFixture(`module-search-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "typed-index",
          "binary-vector-knn",
          "projection",
          "reply-flags",
          "dialect",
          "missing-options",
        ],
      });
    }),
  90_000,
);
