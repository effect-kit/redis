import { Context, Effect } from "effect";
import type { Layer, Option, Scope } from "effect";

import { Commands, Redis, RedisScript, RedisSentinel, makeRedisSentinel } from "#/index";
import type {
  BatchExecutor,
  RedisSentinelClient,
  SentinelConfig,
  SentinelOptions,
  Transport,
} from "#/index";

class DataCredentials extends Context.Service<DataCredentials, { readonly marker: string }>()(
  "SentinelDataCredentials",
) {}
class ControlCredentials extends Context.Service<ControlCredentials, { readonly marker: string }>()(
  "SentinelControlCredentials",
) {}
class Decoder extends Context.Service<Decoder, { readonly value: string }>()("SentinelDecoder") {}

declare const config: SentinelConfig;
declare const client: RedisSentinelClient;
const acquisition = makeRedisSentinel(config, {
  connection: { credentials: DataCredentials.pipe(Effect.as(undefined)) },
  sentinelConnection: { credentials: ControlCredentials.pipe(Effect.as(undefined)) },
});
const layer = RedisSentinel.layer(config);
const read = client.redis.get("key");
const batch = client.pipeline([Commands.get("key"), Commands.incr("other")] as const);
const session = client.withSession((lease) => lease.get("key"));
const decoded = client.redis.execute(
  Commands.evalScript("return 1", { keys: [] }, () =>
    Decoder.pipe(Effect.map((service) => service.value)),
  ),
);
const definition = RedisScript.make({
  source: "return 1",
  decode: () => Decoder.pipe(Effect.map((service) => service.value)),
});
declare const script: Effect.Success<typeof definition>;
const scripted = client
  .scripts()
  .pipe(Effect.flatMap((scripts) => scripts.execute(script, { keys: ["one", "other"] })));
const control = client.sentinel(0).execute(Commands.sentinelGetMasterAddrByName("cache"));
const subscription = client.pubsub();
const tracking = client.tracking();
const admin = client.admin.info();
const program = Redis.pipe(
  Effect.flatMap((redis) => redis.get("key")),
  Effect.provide(layer),
);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type SentinelContracts = [
  Assert<
    Equal<
      Effect.Services<typeof acquisition>,
      DataCredentials | ControlCredentials | Transport | Scope.Scope
    >
  >,
  Assert<Equal<Layer.Services<typeof layer>, Transport>>,
  Assert<Equal<Effect.Success<typeof read>, Option.Option<string>>>,
  Assert<Equal<Effect.Services<typeof read>, never>>,
  Assert<Equal<Effect.Services<typeof batch>, never>>,
  Assert<Equal<Effect.Services<typeof session>, never>>,
  Assert<Equal<Effect.Services<typeof decoded>, Decoder>>,
  Assert<Equal<Effect.Success<typeof decoded>, string>>,
  Assert<Equal<Effect.Services<typeof scripted>, Decoder>>,
  Assert<Equal<Effect.Services<typeof control>, never>>,
  Assert<Equal<Effect.Services<typeof subscription>, Scope.Scope>>,
  Assert<Equal<Effect.Services<typeof tracking>, Scope.Scope>>,
  Assert<Equal<Effect.Services<typeof admin>, never>>,
  Assert<Equal<Effect.Services<typeof program>, Transport>>,
];

const batched = Redis.pipe(Effect.flatMap((redis) => redis.pipeline([Commands.get("key")])));
export type SentinelBatchContract = Assert<
  Equal<Effect.Services<typeof batched>, Redis | BatchExecutor>
>;

// @ts-expect-error Sentinel credentials have their own connection policy.
RedisSentinel.layer(config, { sentinelPassword: "secret" });
// @ts-expect-error Data read policy cannot promise linearizable replicas.
const invalid: SentinelOptions = { readPreference: "linearizable" };
void invalid;
// @ts-expect-error Explicit control targets are endpoint indexes.
client.sentinel("first");
// @ts-expect-error Service names are strings.
Commands.sentinelGetMasterAddrByName(42);
// @ts-expect-error Configuration settings require redaction.
Commands.sentinelConfigSet([["sentinel-pass", "secret"]]);
// @ts-expect-error INFO-CACHE requires a nonempty service selection.
Commands.sentinelInfoCache([]);
// @ts-expect-error Replica-facing options are separate from database identity.
client.withSession({ role: "replica" }, (lease: never) => lease);
