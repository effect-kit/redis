import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { encodeFloat32 } from "#/index";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { waitForSearchCount } from "#test/support/modules/SearchReady";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-FT-CONTROL: $fixture.id $protocol dictionaries, suggestions and hybrid",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, observed, server } = yield* moduleBackend(fixture, protocol);
      const index = `${prefix}:idx`;
      yield* redis.ftCreate(
        index,
        [
          { field: "title", type: "TEXT" },
          { field: "tag", type: "TAG" },
          {
            field: "v",
            type: "VECTOR",
            algorithm: "FLAT",
            attributes: { dataType: "FLOAT32", dimensions: 2, distanceMetric: "COSINE" },
          },
        ],
        { on: "HASH", prefixes: [`${prefix}:doc:`] },
      );
      const key = `${prefix}:doc:one`;
      const vector = yield* encodeFloat32([1, 0]);
      yield* redis.hset(key, [
        ["title", "hello world"],
        ["tag", "a"],
        ["v", vector],
      ]);
      yield* waitForSearchCount(redis, index, 1n, "hello");

      if (fixture.engine === "valkey") {
        expect(yield* Effect.flip(redis.ftSugadd(`${prefix}:s`, "hello", 1))).toMatchObject({
          _tag: "ServerError",
        });
        expect(
          yield* Effect.flip(
            redis.ftHybrid(
              index,
              "hello",
              { field: "@v", vector: "$vec" },
              { params: [["vec", vector]] },
            ),
          ),
        ).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.ftSearch(index, "*"))).toMatchObject({
          _tag: "ServerError",
        });
      } else {
        const alias = `${prefix}:alias`;
        yield* redis.ftAliasadd(alias, index);
        yield* redis.ftAliasupdate(alias, index);
        expect((yield* redis.ftSearch(alias, "hello")).total).toBe(1n);
        if (fixture.id === "redis-modules")
          expect(yield* redis.ftAliaslist(index)).toEqual([new TextEncoder().encode(alias)]);
        else
          expect(yield* Effect.flip(redis.ftAliaslist(index))).toMatchObject({
            _tag: "ServerError",
          });
        yield* redis.ftAliasdel(alias);
        const dictionary = `${prefix}:dictionary`;
        expect(yield* redis.ftDictadd(dictionary, ["hello", "world"])).toBe(2n);
        expect((yield* redis.ftDictdump(dictionary)).length).toBe(2);
        expect(
          (yield* redis.ftSpellcheck(index, "helo", { distance: 1, dialect: 2 }))[0]?.suggestions[0]
            ?.term,
        ).toEqual(new TextEncoder().encode("hello"));
        expect(yield* redis.ftDictdel(dictionary, ["world"])).toBe(1n);
        yield* redis.ftSynupdate(index, "group", ["hello", "greetings"], { skipInitialScan: true });
        expect((yield* redis.ftSyndump(index)).length).toBe(2);
        expect(yield* redis.ftTagvals(index, "tag")).toContainEqual(new TextEncoder().encode("a"));
        expect(Option.isSome(yield* redis.ftGet(index, key))).toBe(true);
        expect((yield* redis.ftMget(index, [key, `${prefix}:missing`]))[1]).toEqual(Option.none());
        expect(Redacted.value(yield* redis.ftConfigGet("TIMEOUT")).length).toBe(1);
        expect(Redacted.value(yield* redis.ftConfigHelp("TIMEOUT")).length).toBe(1);
        yield* redis.ftConfigSet("TIMEOUT", Redacted.make("500"));
        const suggestion = `${prefix}:suggest`;
        expect(
          yield* redis.ftSugadd(suggestion, "hello", 1, { payload: new Uint8Array([0, 255]) }),
        ).toBe(1n);
        expect(yield* redis.ftSugadd(suggestion, "hello", 1, { increment: true })).toBe(1n);
        expect(yield* redis.ftSuglen(suggestion)).toBe(1n);
        expect((yield* redis.ftSugget(suggestion, "he", { fuzzy: true, max: 2 })).length).toBe(1);
        expect((yield* redis.ftSuggetWithScores(suggestion, "he"))[0]?.[1]).toBeGreaterThan(0);
        expect((yield* redis.ftSuggetWithPayloads(suggestion, "he"))[0]?.[1]).toEqual(
          Option.some(new Uint8Array([0, 255])),
        );
        expect((yield* redis.ftSuggetWithScoresAndPayloads(suggestion, "he"))[0]?.payload).toEqual(
          Option.some(new Uint8Array([0, 255])),
        );
        expect(yield* redis.ftSugdel(suggestion, "hello")).toBe(true);

        if (fixture.id === "redis-modules") {
          const options = {
            params: [["vec", vector]] as const,
            combine: { _tag: "RRF" as const, window: 10 },
            steps: [{ _tag: "Load" as const, fields: [{ field: "@title" }] }],
          };
          const query = {
            field: "@v" as const,
            vector: "$vec",
            neighbors: { _tag: "KNN" as const, count: 2 },
          };
          const hybrid = yield* redis.ftHybrid(index, "hello", query, options);
          expect(hybrid.total).toBe(1n);
          expect(hybrid.rows.length).toBe(1);
          expect((yield* redis.ftProfileHybrid(index, "hello", query, options)).result.total).toBe(
            1n,
          );
          expect(
            (yield* redis.ftHybrid(
              index,
              "hello",
              {
                field: "@v",
                vector: "$vec",
                neighbors: { _tag: "Range", radius: 1 },
                filter: { expression: "@tag:{a}" },
              },
              {
                ...options,
                combine: { _tag: "Linear", weights: [0.5, 0.5] },
                combinedScoreAs: "hybrid",
                limit: { offset: 0, count: 1 },
              },
            )).total,
          ).toBe(1n);
        } else
          expect(
            yield* Effect.flip(
              redis.ftHybrid(
                index,
                "hello",
                { field: "@v", vector: "$vec" },
                { params: [["vec", vector]] },
              ),
            ),
          ).toMatchObject({ _tag: "ServerError" });
        const legacy = `${prefix}:doc:legacy`;
        expect(yield* redis.ftAdd(index, legacy, 0.5, [["title", "legacy"]])).toBe(true);
        expect(yield* redis.ftSafeadd(index, `${legacy}:safe`, 0.5, [["title", "legacy"]])).toBe(
          true,
        );
        expect(yield* redis.ftDel(index, legacy)).toBe(true);
        const oldIndex = `${prefix}:old`;
        yield* redis.ftCreate(oldIndex, [{ field: "title", type: "TEXT" }], {
          prefixes: [`${prefix}:old-doc:`],
        });
        yield* redis.ftDrop(oldIndex, { keepDocuments: true });
      }
      yield* redis.ftDropindex(index);
      yield* recordFixture(`module-search-controls-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "aliases",
          "dictionaries",
          "spelling",
          "suggestions",
          "legacy-documents",
          "hybrid",
          "profile",
        ],
      });
    }),
  90_000,
);
