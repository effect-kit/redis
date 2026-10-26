import { Effect, Option, Schema, Stream } from "effect";

import { core, ensure, eventually } from "#test/runners/bun/Runtime";
import type { RuntimeInput } from "#test/support/runtime/bun/Input";

export const modules = Effect.fnUntraced(function* (
  input: Extract<RuntimeInput, { scenario: "modules" }>,
) {
  const config = yield* core.decodeRedisConfig(input.config);
  const connection = yield* core.makeConnection(config);
  const redis = core.makeRedis(core.makeExecutor(connection));
  const sessions = yield* core.makeRedisSessions(config);
  const prefix = `bun:module:${crypto.randomUUID()}`;
  const codec = core.PayloadCodec.json(Schema.Struct({ name: Schema.String }));

  yield* redis.jsonSetWith(`${prefix}:json`, "$", { name: "Bun" }, codec);
  const saved = yield* redis.jsonGetWith(`${prefix}:json`, codec);
  ensure(Option.isSome(saved) && saved.value.name === "Bun", "JSON module Schema roundtrip failed");
  ensure(yield* redis.bfAdd(`${prefix}:bloom`, "member"), "Bloom insertion failed");
  ensure(yield* redis.bfExists(`${prefix}:bloom`, "member"), "Bloom membership failed");

  const index = `${prefix}:index`;
  const vector = yield* core.encodeFloat32([1, 0]);
  yield* redis.ftCreate(
    index,
    [
      { field: "title", type: "TEXT" },
      {
        field: "v",
        type: "VECTOR",
        algorithm: "HNSW",
        attributes: { dataType: "FLOAT32", dimensions: 2, distanceMetric: "COSINE" },
      },
    ],
    { on: "HASH", prefixes: [`${prefix}:doc:`] },
  );
  yield* redis.hset(`${prefix}:doc:one`, [
    ["title", "hello"],
    ["v", vector],
  ]);
  yield* eventually(
    redis.ftSearch(index, "hello").pipe(Effect.map((reply) => reply.total === 1n)),
    "Search module did not index data",
  );
  const matches = yield* redis.ftSearch(index, "*=>[KNN 1 @v $vector]", {
    dialect: 2,
    noContent: true,
    params: [["vector", vector]],
  });
  ensure(matches.documents.length === 1, "Binary vector search failed");

  const search = core.makeRedisSearch(sessions);
  const rows = search.aggregate(
    index,
    "hello",
    { steps: [{ _tag: "Load", fields: [{ field: "@title" }] }] },
    { count: 1 },
  );
  if (input.profile === "valkey-modules") {
    ensure(
      (yield* Effect.flip(Stream.runCollect(rows)))._tag === "ServerError",
      "Unsupported Valkey cursors were emulated",
    );
    ensure(
      (yield* Effect.flip(redis.tsCreate(`${prefix}:ts`)))._tag === "ServerError",
      "Missing TimeSeries module was hidden",
    );
  } else {
    ensure((yield* Stream.runCollect(rows)).length === 1, "Scoped module cursor failed");
    yield* redis.tsCreate(`${prefix}:ts`);
    yield* redis.tsAdd(`${prefix}:ts`, 9007199254740993n, 1.25);
    const sample = yield* redis.tsGet(`${prefix}:ts`);
    ensure(
      Option.isSome(sample) &&
        sample.value.timestamp === 9007199254740993n &&
        sample.value.value === 1.25,
      "TimeSeries precision changed",
    );
    yield* redis.cfAdd(`${prefix}:cf`, "member");
    ensure((yield* redis.cfCount(`${prefix}:cf`, "member")) === 1n, "Cuckoo count changed");
    yield* redis.cmsInitbydim(`${prefix}:cms`, 100, 4);
    ensure(
      (yield* redis.cmsIncrby(`${prefix}:cms`, [["member", 2]]))[0] === 2n,
      "CMS count changed",
    );
    yield* redis.topkReserve(`${prefix}:top`, 2);
    yield* redis.topkAdd(`${prefix}:top`, ["member"]);
    ensure((yield* redis.topkQuery(`${prefix}:top`, ["member"]))[0], "TopK membership failed");
    yield* redis.tdigestCreate(`${prefix}:td`);
    yield* redis.tdigestAdd(`${prefix}:td`, [1, 2, 3, 4, 5]);
    ensure(
      (yield* redis.tdigestQuantile(`${prefix}:td`, [0.5]))[0] === 3,
      "t-digest median changed",
    );
  }

  if (input.profile === "redis-modules") {
    ensure(
      yield* redis.vadd(`${prefix}:vectors`, { _tag: "FP32", bytes: vector }, "one"),
      "Vector-set insertion failed",
    );
    ensure((yield* redis.vcard(`${prefix}:vectors`)) === 1n, "Vector-set cardinality changed");
  } else {
    ensure(
      (yield* Effect.flip(redis.vcard(`${prefix}:vectors`)))._tag === "ServerError",
      "Missing vector-set family was hidden",
    );
  }

  yield* redis.ftDropindex(index);
  return [
    "json-schema",
    "bloom",
    "binary-vector-search",
    "leased-cursor",
    "module-availability",
    "exact-time",
    "probabilistic",
    "vector-sets",
  ];
});
