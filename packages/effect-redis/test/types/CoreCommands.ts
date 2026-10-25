// Compile-only contracts: these expressions must never be selected by Vitest.
import type { Effect, Option } from "effect";

import { Commands } from "#/index";
import type {
  ArrayInfo,
  GeoQuery,
  GeoResult,
  KeyValues,
  LcsMatches,
  RedisClient,
  SortedRange,
} from "#/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

declare const redis: RedisClient;
const entries = [["a", new Uint8Array([255])]] as const satisfies KeyValues;
const range = { by: "score", min: { exclusive: 1 }, max: "+inf" } as const satisfies SortedRange;
const query = {
  origin: { member: "city" },
  area: { width: 100, height: 100, unit: "km" },
} as const satisfies GeoQuery;

const multi = redis.mget(["a", "b"]);
const hash = redis.hget("h", "f");
const hashAll = redis.hgetall("h");
const hashFloat = redis.hincrbyfloat("h", "n", "1e400");
const fieldTtl = redis.hpttl("h", ["f"]);
const pop = redis.lpop("list");
const popMany = redis.lpopCount("list", 2);
const listMany = redis.lmpop(["list"], "LEFT");
const setMember = redis.sismember("set", "v");
const setMany = redis.spopCount("set", 2);
const rank = redis.zrankWithScore("sorted", "v");
const scores = redis.zrangeWithScores("sorted", range);
const sortedMany = redis.zmpop(["sorted"], "MIN");
const floats = redis.increxFloat("f", { increment: "0.5" });
const exact = redis.increx("n", { increment: 9007199254740993n });
const fields = redis.bitfield("bits", [
  { operation: "GET", encoding: { signed: true, bits: 64 }, offset: 0 },
]);
const geo = redis.geosearchWith("geo", query, { coordinates: true });
const position = redis.geopos("geo", ["city"]);
const cursor = redis.arnext("array");
const info = redis.arinfo("array", true);
const lcs = redis.lcsMatches("a", "b");
const type = redis.type("a");
const atomic = redis.mset(entries);
const sort = redis.sort("list", { get: ["field:*"] });
const ttl = redis.ttl("a");

export type CoreInference = [
  Assert<Equal<Effect.Success<typeof multi>, ReadonlyArray<Option.Option<Uint8Array>>>>,
  Assert<Equal<Effect.Success<typeof hash>, Option.Option<Uint8Array>>>,
  Assert<
    Effect.Success<typeof hashAll> extends ReadonlyArray<readonly [Uint8Array, Uint8Array]>
      ? true
      : false
  >,
  Assert<
    ReadonlyArray<readonly [Uint8Array, Uint8Array]> extends Effect.Success<typeof hashAll>
      ? true
      : false
  >,
  Assert<Equal<Effect.Success<typeof hashAll>[number][0], Uint8Array>>,
  Assert<Equal<Effect.Success<typeof hashAll>[number][1], Uint8Array>>,
  Assert<Equal<Effect.Success<typeof hashFloat>, string>>,
  Assert<Equal<Effect.Success<typeof fieldTtl>, ReadonlyArray<bigint>>>,
  Assert<Equal<Effect.Success<typeof pop>, Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof popMany>, Option.Option<ReadonlyArray<Uint8Array>>>>,
  Assert<
    Equal<
      Effect.Success<typeof listMany>,
      Option.Option<readonly [Uint8Array, ReadonlyArray<Uint8Array>]>
    >
  >,
  Assert<Equal<Effect.Success<typeof setMember>, boolean>>,
  Assert<Equal<Effect.Success<typeof setMany>, ReadonlyArray<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof rank>, Option.Option<readonly [bigint, string]>>>,
  Assert<Equal<Effect.Success<typeof scores>, ReadonlyArray<readonly [Uint8Array, string]>>>,
  Assert<
    Equal<
      Effect.Success<typeof sortedMany>,
      Option.Option<readonly [Uint8Array, ReadonlyArray<readonly [Uint8Array, string]>]>
    >
  >,
  Assert<Equal<Effect.Success<typeof floats>, readonly [string, string]>>,
  Assert<Equal<Effect.Success<typeof exact>, readonly [bigint, bigint]>>,
  Assert<Equal<Effect.Success<typeof fields>, ReadonlyArray<Option.Option<bigint>>>>,
  Assert<Equal<Effect.Success<typeof geo>, ReadonlyArray<GeoResult>>>,
  Assert<
    Equal<Effect.Success<typeof position>, ReadonlyArray<Option.Option<readonly [number, number]>>>
  >,
  Assert<Equal<Effect.Success<typeof cursor>, Option.Option<bigint>>>,
  Assert<Equal<Effect.Success<typeof info>, ArrayInfo>>,
  Assert<Equal<Effect.Success<typeof lcs>, LcsMatches>>,
  Assert<Equal<Effect.Success<typeof type>, string>>,
  Assert<Equal<Effect.Success<typeof atomic>, void>>,
  Assert<Equal<Effect.Success<typeof sort>, ReadonlyArray<Option.Option<Uint8Array>>>>,
  Assert<Equal<Effect.Success<typeof ttl>, bigint>>,
];

// @ts-expect-error Empty key lists do not encode a valid multi-key request.
redis.mget([]);

// @ts-expect-error A key/value entry is an ordered pair.
redis.mset([["a"]]);

// @ts-expect-error No automatic JSON serialization of hash values.
redis.hset("h", [["f", { json: true }]]);

// @ts-expect-error Expiry units must be named explicitly.
redis.getex("a", { milliseconds: 1 });

// @ts-expect-error Rank ranges cannot carry a score/lex LIMIT.
redis.zrange("z", { by: "rank", start: 0, end: -1, limit: { offset: 0, count: 1 } });

// @ts-expect-error A score range needs both endpoints.
redis.zrange("z", { by: "score", min: 1 });

// @ts-expect-error Exclusive lex bounds wrap bytes explicitly.
redis.zlexcount("z", "[a", "+");

redis.bitfieldRo("b", [
  // @ts-expect-error Read-only BITFIELD cannot write.
  { operation: "SET", encoding: { signed: true, bits: 8 }, offset: 0, value: 1 },
]);

// @ts-expect-error A bit is exactly zero or one.
redis.setbit("b", 0, 2);

// @ts-expect-error Directions use the wire enum rather than arbitrary strings.
redis.lmove("a", "b", "UP", "LEFT");

// @ts-expect-error SET/array payloads remain bytes or strings.
redis.arset("a", 0, [{ value: "v" }]);

// @ts-expect-error A geo shape has a required unit.
redis.geosearch("g", { origin: { member: "m" }, area: { radius: 1 } });

// @ts-expect-error New command descriptions preserve the key tuple requirement.
Commands.zinter([]);
