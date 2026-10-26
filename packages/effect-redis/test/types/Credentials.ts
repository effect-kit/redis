import { Config, Context, Effect, Redacted } from "effect";
import type { Layer } from "effect";
import type { HttpClient } from "effect/http";

import { RedisBun } from "#/bun";
import {
  Redis,
  RedisCredentials,
  RedisProfiles,
  RedisSentinelCredentials,
  RedisSessions,
} from "#/index";
import type { CredentialError, CredentialValues } from "#/index";
import { RedisNode } from "#/node";
import { RedisUpstash } from "#/upstash";

class DataIdentity extends Context.Service<DataIdentity, CredentialValues>()("test/DataIdentity") {}
class ControlIdentity extends Context.Service<ControlIdentity, CredentialValues>()(
  "test/ControlIdentity",
) {}

const source = RedisCredentials.provider(DataIdentity, { maxWaiters: 8 });
const native = RedisNode.layer({ url: "rediss://cache.example", credentials: source });
const bun = RedisBun.layerConfig(
  Config.succeed({ url: "rediss://cache.example", credentials: source }),
);
const cluster = RedisNode.layerCluster({
  url: "rediss://cache.example",
  credentials: source,
  profile: RedisProfiles.memorydb({ engine: "valkey", authentication: "iam" }),
  network: { allowedHosts: ["cache.example"], allowedServerNames: ["cache.example"] },
});
const sentinel = RedisBun.layerSentinel({
  serviceName: "cache",
  sentinels: [{ endpoint: { host: "sentinel.example" } }],
  credentials: source,
  sentinelCredentials: ControlIdentity,
});
const http = RedisUpstash.layer({ url: "https://cache.example", credentials: source });
const customHttp = RedisUpstash.layerWithHttpClient({
  url: "https://cache.example",
  credentials: source,
});
const rotate = RedisCredentials.pipe(Effect.flatMap((credentials) => credentials.rotate));
const nativeRotation = rotate.pipe(Effect.provide(native));
const httpRotation = rotate.pipe(Effect.provide(http));
const controlRotation = RedisSentinelCredentials.pipe(
  Effect.flatMap((credentials) => credentials.rotate),
  Effect.provide(sentinel),
);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type CredentialContracts = [
  Assert<Equal<Layer.Services<typeof native>, DataIdentity>>,
  Assert<Equal<Layer.Services<typeof bun>, DataIdentity>>,
  Assert<Equal<Layer.Services<typeof cluster>, DataIdentity>>,
  Assert<Equal<Layer.Services<typeof sentinel>, DataIdentity | ControlIdentity>>,
  Assert<Equal<Layer.Services<typeof http>, DataIdentity>>,
  Assert<Equal<Layer.Services<typeof customHttp>, DataIdentity | HttpClient.HttpClient>>,
  Assert<Equal<Effect.Services<typeof nativeRotation>, DataIdentity>>,
  Assert<Equal<Effect.Services<typeof httpRotation>, DataIdentity>>,
  Assert<Equal<Effect.Services<typeof controlRotation>, DataIdentity | ControlIdentity>>,
  Assert<Equal<Effect.Error<typeof rotate>, CredentialError>>,
];

// @ts-expect-error Token source services must be supplied at construction.
Effect.runPromise(Redis.pipe(Effect.provide(http)));

const missingSessions = RedisSessions.pipe(
  Effect.provide(cluster),
  Effect.provideService(DataIdentity, { password: Redacted.make("synthetic") }),
);
// @ts-expect-error Native Cluster does not advertise a standalone session pool.
Effect.runPromise(missingSessions);

// @ts-expect-error HTTP token and credential source are mutually exclusive.
RedisUpstash.layer({
  url: "https://cache.example",
  token: Redacted.make("synthetic"),
  credentials: source,
});

const invalidExpiry = Effect.succeed({
  password: Redacted.make("synthetic"),
  expiresAtMillis: new Date(),
});
// @ts-expect-error Epoch expiry is a number in milliseconds, not a Date.
RedisCredentials.provider(invalidExpiry);

// @ts-expect-error Credential Effects must preserve redacted secret values.
RedisCredentials.provider(Effect.succeed({ password: "synthetic" }));

// @ts-expect-error Engine and topology selections are explicit for ElastiCache.
RedisProfiles.elasticache({ authentication: "iam" });

// @ts-expect-error Proxy mode is not a Memorystore Valkey Cluster policy.
RedisProfiles.memorystoreValkey({ routing: "proxy", authentication: "iam", tls: "required" });

// @ts-expect-error Module gates use reviewed families, not arbitrary modules.
RedisProfiles.redis({ modules: ["made-up-module"] });
