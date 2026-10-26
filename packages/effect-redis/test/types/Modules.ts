import { Schema } from "effect";
import type { Effect, Option } from "effect";

import { Commands, PayloadCodec } from "#/index";
import type { RedisClient, JsonMatches, JsonNumericLegacy } from "#/index";
import { labelSchema } from "#test/support/commands/SchemaServices";
import type { DecodeLabel, EncodeLabel } from "#test/support/commands/SchemaServices";

declare const redis: RedisClient;
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
