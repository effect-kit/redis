// TYPES-01/TYPES-02: positive inference and intentional public API errors; never executed.
import { Effect, Schema } from "effect";
import type { Option } from "effect";

import { pingMetadata } from "../../src/commands/connection/Ping.js";
import { Commands, Redis, RedisKey, Reply, defineCommand } from "../../src/index.js";
import type { Command, RedisClient, SetOptions } from "../../src/index.js";
import {
  type DecodeLabel,
  type EncodeLabel,
  labelSchema,
} from "../support/commands/SchemaServices.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
declare const redis: RedisClient;
declare const options: SetOptions;
declare const dynamicGet: boolean;
declare const dynamicCondition: "NX" | "XX" | undefined;
const plain = redis.set("key", "value");
const conditional = redis.set("key", "value", { condition: "NX" });
const previous = redis.set("key", "value", { get: true, condition: "NX" });
const dynamic = redis.set("key", "value", options);
const dynamicGetResult = redis.set("key", "value", { get: dynamicGet });
const dynamicConditionResult = redis.set(
  "key",
  "value",
  dynamicCondition === undefined ? {} : { condition: dynamicCondition },
);
const undefinedCondition = redis.set("key", "value", { condition: undefined });
const explicitlyFalse = redis.set("key", "value", { get: false, condition: "NX" });
const optionalCondition = redis.set("key", "value", { condition: dynamicCondition });
const absent = redis.get("key");
const bytes = redis.getBytes("key");
const count = redis.incr("count");
const scores = redis.zscore("scores", "member");
const tupleDecoder = Reply.array(Reply.integer);
const labels = RedisKey.schemaText("label", labelSchema);
const decoding = redis.getKey(labels);
const encoding = redis.setKey(labels, "value");
const decodingCommand = redis.execute(Commands.getKey(labels));
const encodingCommand = redis.execute(Commands.setKey(labels, "value"));
const prepareRead = Commands.getKey(labels).prepare;
const prepareWrite = Commands.setKey(labels, "value").prepare;
const preparedRead = Effect.flatMap(prepareRead, redis.executePrepared);
const User = Schema.Struct({ name: Schema.String, role: Schema.Literals(["admin", "member"]) });
const userKey = RedisKey.json("user", User);
const user = redis.getKey(userKey);
const ping = Effect.gen(function* () {
  return yield* (yield* Redis).ping();
});
const custom = defineCommand({
  metadata: { ...pingMetadata, name: "CUSTOM.COUNT" },
  tokens: ["CUSTOM.COUNT"],
  routing: { _tag: "Keyless" },
  decode: Reply.integer,
});
const customCount = redis.execute(custom);

export type Contracts = [
  Assert<Equal<Effect.Success<typeof plain>, void>>,
  Assert<Equal<Effect.Success<typeof conditional>, boolean>>,
  Assert<Equal<Effect.Success<typeof previous>, Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof dynamic>, void | boolean | Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof dynamicGetResult>, void | Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof dynamicConditionResult>, void | boolean>>,
  Assert<Equal<Effect.Success<typeof undefinedCondition>, void>>,
  Assert<Equal<Effect.Success<typeof explicitlyFalse>, boolean>>,
  Assert<Equal<Effect.Success<typeof optionalCondition>, void | boolean>>,
  Assert<Equal<Effect.Services<typeof prepareRead>, never>>,
  Assert<Equal<Effect.Services<typeof prepareWrite>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof preparedRead>, DecodeLabel>>,
  Assert<Equal<Effect.Success<typeof absent>, Option.Option<string>>>,
  Assert<Equal<Effect.Success<typeof bytes>, Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof count>, bigint>>,
  Assert<Equal<Effect.Success<typeof scores>, Option.Option<number>>>,
  Assert<Equal<Effect.Success<ReturnType<typeof tupleDecoder>>, ReadonlyArray<bigint>>>,
  Assert<Equal<Effect.Services<typeof decoding>, DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof encoding>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof decodingCommand>, DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof encodingCommand>, EncodeLabel>>,
  Assert<Equal<Effect.Success<typeof user>, Option.Option<typeof User.Type>>>,
  Assert<Equal<Effect.Services<typeof ping>, Redis>>,
  Assert<Equal<Effect.Success<typeof customCount>, bigint>>,
];

// @ts-expect-error Schema payload types come from the key, not a caller-supplied result generic.
redis.setKey(userKey, { name: "Ada", role: "owner" });
// @ts-expect-error Schema keys retain their actual value type.
redis.setKey(userKey, "arbitrary-string");
// @ts-expect-error Expiration modes are exclusive.
redis.set("key", "value", { expiry: { type: "KEEPTTL", value: 1 } } satisfies SetOptions);
// @ts-expect-error Expiration units require a numeric value.
redis.set("key", "value", { expiry: { type: "PX", value: "1 second" } });
// @ts-expect-error Ordinary get cannot assert an arbitrary result type.
redis.get<{ invented: true }>("key");
// @ts-expect-error A decoder establishes the result type.
const invented: Command<string> = custom;
// @ts-expect-error Typed-key writes do not provide the raw SET GET modifier.
redis.setKey(userKey, { name: "Ada", role: "admin" }, { get: true });
// @ts-expect-error Encoding services cannot disappear from the operation.
const missingEncoding: Effect.Effect<unknown, unknown> = encoding;
// @ts-expect-error Decoding services cannot disappear from the operation.
const missingDecoding: Effect.Effect<unknown, unknown> = decoding;
void invented;
void missingEncoding;
void missingDecoding;
