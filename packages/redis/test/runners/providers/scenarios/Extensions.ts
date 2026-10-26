import { Effect, Option, Schema } from "effect";

import { PayloadCodec } from "@effect-kit/redis";
import type { RedisClient } from "@effect-kit/redis";
import { Commands } from "@effect-kit/redis/upstash";

import { ensure, sameBytes, utf8 } from "#test/runners/providers/scenarios/Assertions";
import type { assertions } from "#test/runners/providers/scenarios/Assertions";

/** These are Redis-hosted SEARCH/VECTOR commands, independent of Upstash's separate Vector product. */
export const extensions = Effect.fnUntraced(function* (
  redis: RedisClient,
  prefix: string,
  { check }: ReturnType<typeof assertions>,
) {
  const vector = `${prefix}vector`;
  yield* check(
    "extensions.vector-create",
    redis.upstash.vectorCreate(vector, { dimension: 3, metric: "COSINE" }),
    (reply) => ensure(reply, "vector-create"),
  );
  yield* check(
    "extensions.vector-values",
    redis.upstash.vectorAdd(vector, "first", { _tag: "Values", coordinates: [1, 0, 0] }),
    (reply) => ensure(reply, "vector-values"),
  );
  yield* check(
    "extensions.vector-base64-fp32",
    redis.upstash.vectorAdd(vector, "second", yield* Commands.base64Fp32([0, 1, 0])),
    (reply) => ensure(reply, "vector-fp32"),
  );
  yield* check("extensions.vector-get", redis.upstash.vectorGet(vector, "first"), (reply) =>
    ensure(Option.isSome(reply) && reply.value.length === 3 && reply.value[0] === 1, "vector-get"),
  );
  yield* check("extensions.vector-count", redis.upstash.vectorCount(vector), (reply) =>
    ensure(reply === 2n, "vector-count"),
  );
  yield* check("extensions.vector-info", redis.upstash.vectorInfo(vector), (reply) =>
    ensure(
      Option.isSome(reply) && reply.value.dimension === 3 && reply.value.metric === "COSINE",
      "vector-info",
    ),
  );
  yield* check(
    "extensions.vector-query",
    redis.upstash.vectorQuery(vector, { _tag: "Values", coordinates: [1, 0, 0] }, { topK: 1 }),
    (reply) =>
      ensure(
        reply.length === 1 &&
          sameBytes(reply[0]?.id, utf8("first")) &&
          (reply[0]?.score ?? 0) > 0.99,
        "vector-query",
      ),
  );
  yield* check("extensions.vector-delete", redis.upstash.vectorDel(vector, "second"), (reply) =>
    ensure(reply, "vector-delete"),
  );
  yield* check("extensions.vector-drop", redis.upstash.vectorDrop(vector), (reply) =>
    ensure(reply, "vector-drop"),
  );

  const index = `${prefix}search-index`;
  const alias = `${prefix}search-alias`;
  // An index/alias has its own namespace, so ordinary DEL is insufficient for teardown.
  yield* Effect.addFinalizer(() =>
    redis.upstash
      .searchAliasDel(alias)
      .pipe(Effect.andThen(redis.upstash.searchDrop(index)), Effect.orDie),
  );
  yield* check(
    "extensions.search-create",
    redis.upstash.searchCreate(index, {
      on: { type: "JSON", prefixes: [`${prefix}document`] },
      fields: [
        { name: "title", type: "TEXT" },
        { name: "price", type: "F64", fast: true },
      ],
    }),
    (reply) => ensure(reply, "search-create"),
  );
  const codec = PayloadCodec.json(Schema.Struct({ title: Schema.String, price: Schema.Number }));
  yield* check(
    "extensions.search-document",
    redis.jsonSetWith(`${prefix}document`, "$", { title: "hosted redis", price: 5 }, codec),
    (reply) => ensure(reply, "search-document"),
  );
  yield* check("extensions.search-wait", redis.upstash.searchWaitIndexing(index), (reply) =>
    ensure(reply, "search-wait"),
  );
  yield* check("extensions.search-describe", redis.upstash.searchDescribe(index), (reply) =>
    ensure(
      Option.isSome(reply) && reply.value.name === index && reply.value.type === "JSON",
      "search-describe",
    ),
  );
  yield* check(
    "extensions.search-list",
    redis.upstash.searchListIndexes({ match: index }),
    (reply) =>
      ensure(
        reply.some((entry) => entry.name === index),
        "search-list",
      ),
  );
  yield* check("extensions.search-count", redis.upstash.searchCount(index, {}), (reply) =>
    ensure(reply === 1n, "search-count"),
  );
  yield* check(
    "extensions.search-query",
    redis.upstash.searchQuery(index, { title: "hosted" }),
    (reply) =>
      ensure(
        Option.isSome(reply) &&
          reply.value.length === 1 &&
          sameBytes(reply.value[0]?.key, utf8(`${prefix}document`)),
        "search-query",
      ),
  );
  yield* check("extensions.search-query-keys", redis.upstash.searchQueryKeys(index, {}), (reply) =>
    ensure(
      Option.isSome(reply) &&
        reply.value.length === 1 &&
        sameBytes(reply.value[0]?.key, utf8(`${prefix}document`)),
      "search-query-keys",
    ),
  );
  yield* check(
    "extensions.search-query-codec",
    redis.upstash.searchQueryWith(index, {}, codec),
    (reply) =>
      ensure(
        Option.isSome(reply) && reply.value.length === 1 && reply.value[0]?.value.price === 5,
        "search-query-codec",
      ),
  );
  yield* check(
    "extensions.search-aggregate",
    redis.upstash.searchAggregate(index, {}, { sum: { $sum: { field: "price" } } }),
    (reply) => {
      ensure(Option.isSome(reply), "search-aggregate");
      const value = reply.value.find(([name]) => name === "sum")?.[1];
      ensure(value?._tag === "Array" || value?._tag === "Map", "aggregate-value");
      const pair = value._tag === "Map" ? value.entries[0] : value.values;
      ensure(pair !== undefined && pair.length === 2, "aggregate-pair");
      const [field, amount] = pair;
      ensure(
        (field?._tag === "BlobString" || field?._tag === "SimpleString") &&
          sameBytes(field.value, utf8("value")),
        "aggregate-field",
      );
      ensure(
        (amount?._tag === "Integer" && amount.value === 5n) ||
          (amount?._tag === "Double" && Number(amount.value) === 5) ||
          (amount?._tag === "BlobString" && new TextDecoder().decode(amount.value) === "5"),
        "aggregate-number",
      );
    },
  );
  yield* check("extensions.search-alias-add", redis.upstash.searchAliasAdd(alias, index), (reply) =>
    ensure(reply === 1, "alias-add"),
  );
  yield* check("extensions.search-alias-list", redis.upstash.searchListAliases(), (reply) =>
    ensure(
      reply.some(([name, target]) => name === alias && target === index),
      "alias-list",
    ),
  );
  yield* check("extensions.search-alias-delete", redis.upstash.searchAliasDel(alias), (reply) =>
    ensure(reply, "alias-delete"),
  );
  yield* check("extensions.search-drop", redis.upstash.searchDrop(index), (reply) =>
    ensure(reply, "search-drop"),
  );
});
