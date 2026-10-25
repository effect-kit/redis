import { Context, Effect } from "effect";
import type { Layer, Option, Scope, Stream } from "effect";

import { Commands, Redis, RedisCluster, RedisScript, makeRedisCluster } from "#/index";
import type {
  BatchExecutor,
  ClusterOptions,
  RedisClusterClient,
  RedisConfig,
  Transport,
} from "#/index";

class CredentialSource extends Context.Service<CredentialSource, { readonly marker: string }>()(
  "ClusterCredentials",
) {}
class DecoderSource extends Context.Service<DecoderSource, { readonly result: string }>()(
  "ClusterDecoder",
) {}

declare const config: RedisConfig;
declare const client: RedisClusterClient;
const scriptDefinition = RedisScript.make({
  source: "return 1",
  decode: () => DecoderSource.pipe(Effect.map((source) => source.result)),
});
declare const script: Effect.Success<typeof scriptDefinition>;
const acquisition = makeRedisCluster(config, {
  connection: { credentials: CredentialSource.pipe(Effect.as(undefined)) },
});
const layer = RedisCluster.layer(config);
const text = client.redis.get("key");
const piped = client.pipeline([Commands.get("key"), Commands.incr("key")] as const);
const decoded = client.redis.execute(
  Commands.evalScript("return 1", { keys: ["key"] }, () =>
    DecoderSource.pipe(Effect.map((source) => source.result)),
  ),
);
const scripted = client
  .scripts({ key: "key" })
  .pipe(Effect.flatMap((scripts) => scripts.execute(script, { keys: ["key"] })));
const scan = client.scanKeys();
const native = client.clusterScan("opaque-{tag}-cursor");
const nodeIds = client.onPrimaries(Commands.clusterMyId());
const leased = client.withSession({ key: "key" }, (session) => session.get("key"));
const program = Redis.pipe(
  Effect.flatMap((redis) => redis.get("key")),
  Effect.provide(layer),
);
const admin = client.admin("node").info();

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type ClusterContracts = [
  Assert<Equal<Effect.Services<typeof acquisition>, CredentialSource | Transport | Scope.Scope>>,
  Assert<Equal<Layer.Services<typeof layer>, Transport>>,
  Assert<Equal<Effect.Success<typeof text>, Option.Option<string>>>,
  Assert<Equal<Effect.Services<typeof text>, never>>,
  Assert<Equal<Effect.Services<typeof piped>, never>>,
  Assert<Equal<Effect.Services<typeof decoded>, DecoderSource>>,
  Assert<Equal<Effect.Success<typeof decoded>, string>>,
  Assert<Equal<Effect.Services<typeof scripted>, DecoderSource>>,
  Assert<Equal<Effect.Success<typeof scripted>, string>>,
  Assert<Equal<Stream.Success<typeof scan>, Uint8Array>>,
  Assert<Equal<Stream.Services<typeof scan>, never>>,
  Assert<Equal<Effect.Services<typeof native>, never>>,
  Assert<Equal<Stream.Services<typeof nodeIds>, never>>,
  Assert<Equal<Effect.Services<typeof leased>, never>>,
  Assert<Equal<Effect.Services<typeof program>, Transport>>,
  Assert<Equal<Effect.Services<typeof admin>, never>>,
];

const batches = Redis.pipe(
  Effect.flatMap((redis) => redis.pipeline([Commands.incr("key")] as const)),
);
type BatchServices = Assert<Equal<Effect.Services<typeof batches>, Redis | BatchExecutor>>;
export type ClusterBatchServices = BatchServices;

// @ts-expect-error A session needs an explicit key or physical node target.
client.withSession({}, (session) => session.ping());
// @ts-expect-error Targets are binary keys or node IDs, not numeric slots disguised as keys.
client.scripts({ key: 42 });
// @ts-expect-error Node IDs are explicit strings.
client.admin(42);
// @ts-expect-error Replica consistency is selected by a reviewed policy.
const unsafeReads: ClusterOptions = { readPreference: "linearizable-replicas" };
void unsafeReads;
// @ts-expect-error Database capability must be explicitly selected.
RedisCluster.layer(config, { databaseCapability: "all-redis-databases" });
// @ts-expect-error Slot lists cannot be empty.
Commands.clusterAddSlots([]);
// @ts-expect-error Migration ranges are structured pairs, never an unreviewed token string.
Commands.clusterMigrationImport("1-10");
// @ts-expect-error A node is required for non-STABLE slot states.
Commands.clusterSetSlot(0, { mode: "IMPORTING" });
// @ts-expect-error A raw command still requires declared routing and execution semantics.
client.redis.raw(["CUSTOM", "key"]);
// @ts-expect-error A custom result requires a decoder.
client.redis.evalScript<number>("return 1", { keys: ["key"] });
// @ts-expect-error Cursor arguments remain opaque strings.
client.clusterScan(1n);
