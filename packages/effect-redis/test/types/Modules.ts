import { Duration, Schema } from "effect";
import type { Effect, Option } from "effect";

import { Commands, PayloadCodec } from "#/index";
import type {
  RedisClient,
  JsonMatches,
  JsonNumericLegacy,
  TimeSeriesSample,
  TimeSeriesResult,
  VectorMatch,
  RedisSessionsClient,
} from "#/index";
import { labelSchema } from "#test/support/commands/SchemaServices";
import type { DecodeLabel, EncodeLabel } from "#test/support/commands/SchemaServices";

declare const redis: RedisClient;
declare const sessions: RedisSessionsClient;
const samples = redis.tsRange("t", "-", "+");
const series = redis.tsMrange(0, 100, ["env=prod"]);
const matches = redis.vsimWithScoresAndAttributes("v", { _tag: "Values", coordinates: [1, 0] });
const blocked = sessions.tsReadBlocking("t", "$", { blockFor: Duration.seconds(1) });
const bloom = redis.bfExists("b", "member");
const counts = redis.cmsQuery("c", ["member"]);
const median = redis.tdigestQuantile("t", [0.5]);
const fields = redis.jsonObjlen("j");
const numeric = redis.jsonNumincrbyLegacy("j", ".n", 1);
const codec = PayloadCodec.json(labelSchema);
const read = redis.jsonGetWith("j", codec);
const write = redis.jsonSetWith("j", "$", "value", codec);
const descriptor = Commands.jsonSetWith("j", "$", "value", codec);
const user = PayloadCodec.json(Schema.Struct({ name: Schema.String }));
const document = redis.jsonGetWith("j", user);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type ModuleContracts = [
  Assert<Equal<Effect.Success<typeof samples>, ReadonlyArray<TimeSeriesSample>>>,
  Assert<Equal<Effect.Success<typeof series>, ReadonlyArray<TimeSeriesResult>>>,
  Assert<Equal<Effect.Success<typeof matches>, ReadonlyArray<VectorMatch>>>,
  Assert<Equal<Effect.Success<typeof blocked>, ReadonlyArray<TimeSeriesSample>>>,
  Assert<Equal<Effect.Success<typeof bloom>, boolean>>,
  Assert<Equal<Effect.Success<typeof counts>, ReadonlyArray<bigint>>>,
  Assert<Equal<Effect.Success<typeof median>, ReadonlyArray<number>>>,
  Assert<Equal<Effect.Success<typeof fields>, JsonMatches<bigint>>>,
  Assert<Equal<Effect.Success<typeof numeric>, JsonNumericLegacy>>,
  Assert<Equal<Effect.Services<typeof read>, DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof write>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof descriptor.prepare>, EncodeLabel>>,
  Assert<Equal<Effect.Success<typeof document>, Option.Option<{ readonly name: string }>>>,
];

// @ts-expect-error Application payloads follow their explicit Schema codec.
redis.jsonSetWith("j", "$", { name: 1 }, user);
// @ts-expect-error JSONPath matching APIs require a matching path, with legacy methods separately named.
redis.jsonArrlen("j", ".array");
// @ts-expect-error Get path selections are nonempty when supplied.
redis.jsonGet("j", { paths: [] });
// @ts-expect-error Fixed-shape typed writes do not select an incompatible BSON representation.
redis.jsonSetWith("j", "$", { name: "A" }, user, { format: "BSON" });
// @ts-expect-error Bloom membership values are explicit Redis byte/string arguments.
redis.bfAdd("b", { name: "member" });
// @ts-expect-error Probabilistic insertion accepts at least one element.
redis.cfInsert("c", []);

// @ts-expect-error FP32 vectors require bytes, with no automatic array reinterpretation.
redis.vadd("v", { _tag: "FP32", bytes: [1, 2] }, "member");
// @ts-expect-error TimeSeries blocking reads cannot use the Redis BLOCK-zero forever convention.
sessions.tsReadBlocking("t", "$", { blockFor: "forever" });
// @ts-expect-error Cursor reads have a separately leased blocking method.
redis.tsRead("t", "$", { blockFor: Duration.seconds(1) });
// @ts-expect-error Labels select either all labels or a nonempty selection.
redis.tsMget(["env=prod"], { labels: [] });
