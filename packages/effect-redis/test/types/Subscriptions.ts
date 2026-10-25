// Compile-only public contracts; Vitest never executes these declarations.
import { Effect } from "effect";
import type { Option, Scope, Stream } from "effect";

import { Commands, makeRedisPubSub, makeRedisTracking, RedisKey } from "#/index";
import type {
  PubSubMessage,
  RedisCacheClient,
  RedisClient,
  RedisConfig,
  RedisPubSubClient,
  RedisTrackingClient,
  SubscriptionEvent,
  TrackingInfo,
  Transport,
} from "#/index";
import { EncodeLabel, labelSchema } from "#test/support/commands/SchemaServices";
import type { DecodeLabel } from "#test/support/commands/SchemaServices";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
declare const pubsub: RedisPubSubClient;
declare const tracking: RedisTrackingClient;
declare const cache: RedisCacheClient;
declare const redis: RedisClient;
declare const config: RedisConfig;

const subscription = pubsub.subscribe(["channel"]);
declare const acquired: Effect.Success<typeof subscription>;
const typed = RedisKey.schemaText("key", labelSchema);
const decoded = cache.getKey(typed);
const encoded = tracking.execute(Commands.setKey(typed, "value"));
const trackedDecode = tracking.caching("YES", Commands.getKey(typed));
const publisher = redis.publish("channel", new Uint8Array([255]));
const subscriptions = makeRedisPubSub(config, {
  credentials: EncodeLabel.pipe(Effect.as(undefined)),
});
const tracked = makeRedisTracking(config, { credentials: EncodeLabel.pipe(Effect.as(undefined)) });

export type SubscriptionContracts = [
  Assert<Equal<Effect.Services<typeof subscription>, Scope.Scope>>,
  Assert<Equal<Stream.Success<typeof acquired.messages>, PubSubMessage>>,
  Assert<Equal<Stream.Success<typeof acquired.events>, SubscriptionEvent>>,
  Assert<Equal<Stream.Services<typeof acquired.messages>, never>>,
  Assert<Equal<PubSubMessage["payload"], Uint8Array>>,
  Assert<Equal<Effect.Success<typeof publisher>, bigint>>,
  Assert<Equal<Effect.Success<ReturnType<typeof cache.getBytes>>, Option.Option<Uint8Array>>>,
  Assert<Equal<Effect.Success<typeof decoded>, Option.Option<string>>>,
  Assert<Equal<Effect.Services<typeof decoded>, DecodeLabel>>,
  Assert<Equal<Effect.Services<typeof encoded>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof trackedDecode>, DecodeLabel>>,
  Assert<Equal<Effect.Success<ReturnType<typeof tracking.trackingInfo>>, TrackingInfo>>,
  Assert<Equal<Effect.Services<typeof subscriptions>, Scope.Scope | Transport | EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof tracked>, Scope.Scope | Transport | EncodeLabel>>,
];

// @ts-expect-error Acquiring a subscription requires at least one channel.
pubsub.subscribe([]);
// @ts-expect-error Modes are explicit reviewed variants.
pubsub.subscribe(["c"], { mode: "cluster" });
// @ts-expect-error Recovery cannot silently promise durable replay.
pubsub.subscribe(["c"], { recovery: "replay" });
// @ts-expect-error Tracking prefixes require broadcast mode.
Commands.clientTracking(true, { mode: "optin", prefixes: ["prefix"] });
// @ts-expect-error Managed tracking owns its redirect target.
makeRedisTracking(config, { tracking: { redirect: 123 } });
// @ts-expect-error The caching prefix is an explicit YES/NO choice.
tracking.caching(true, Commands.getBytes("k"));
// @ts-expect-error Publications require explicit Redis bytes or text, not implicit JSON.
redis.publish("c", { payload: "value" });
// @ts-expect-error Applications decode message bytes explicitly.
const implicitText: string = null as unknown as PubSubMessage["payload"];
void implicitText;
