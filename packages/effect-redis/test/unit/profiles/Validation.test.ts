import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { prepareNative } from "#/client/Input";
import { RedisProfiles } from "#/index";

const credentials = { password: Redacted.make("synthetic") };
const cases = [
  {
    name: "Redis Cloud",
    profile: RedisProfiles.redisCloud({ routing: "proxy", authentication: "password" }),
  },
  {
    name: "Redis Software",
    profile: RedisProfiles.redisSoftware({ routing: "proxy", authentication: "password" }),
  },
  {
    name: "ElastiCache",
    profile: RedisProfiles.elasticache({
      engine: "redis",
      deployment: "replication-group",
      routing: "standalone",
      authentication: "password",
    }),
  },
  {
    name: "MemoryDB",
    mode: "cluster" as const,
    profile: RedisProfiles.memorydb({ engine: "valkey", authentication: "password" }),
  },
  { name: "Memorystore Redis", profile: RedisProfiles.memorystoreRedis({ tls: "required" }) },
  {
    name: "Memorystore Valkey",
    profile: RedisProfiles.memorystoreValkey({
      routing: "standalone",
      tls: "required",
      authentication: "optional",
    }),
  },
  {
    name: "Memorystore Redis Cluster",
    mode: "cluster" as const,
    profile: RedisProfiles.memorystoreRedisCluster({ tls: "required", authentication: "optional" }),
  },
  {
    name: "Azure",
    profile: RedisProfiles.azureManagedRedis({
      clustering: "enterprise",
      authentication: "password",
    }),
  },
  { name: "Upstash native", profile: RedisProfiles.upstash({ transport: "native" }) },
  { name: "Aiven", profile: RedisProfiles.aivenValkey({ user: "default" }) },
  { name: "DigitalOcean", profile: RedisProfiles.digitalOceanValkey({ routing: "standalone" }) },
  {
    name: "Tair",
    profile: RedisProfiles.tair({ edition: "enterprise", routing: "proxy", tls: "required" }),
  },
];

it.effect.each(cases)(
  "$name selected TLS profile rejects plaintext before credential acquisition",
  (entry) =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          prepareNative(
            { url: "redis://localhost", credentials, profile: entry.profile },
            entry.mode ?? "standalone",
          ),
        ),
      ).toMatchObject({ _tag: "ProfileError", reason: "tls", delivery: "unsent" });
    }),
);

it.effect(
  "proxy and client Cluster selections remain distinct and zero-DB policy is explicit",
  () =>
    Effect.gen(function* () {
      const proxy = RedisProfiles.redisCloud({ routing: "proxy", authentication: "password" });
      expect(
        yield* Effect.flip(
          prepareNative({ url: "rediss://localhost", credentials, profile: proxy }, "cluster"),
        ),
      ).toMatchObject({ reason: "routing" });
      expect(
        yield* Effect.flip(
          prepareNative({ url: "rediss://localhost", credentials, profile: proxy, database: 1 }),
        ),
      ).toMatchObject({ reason: "database" });
      expect(
        (yield* prepareNative({ url: "rediss://localhost", credentials, profile: proxy })).config
          .database,
      ).toBe(0);
    }),
);

it.effect("token profiles require an Effect identity and explicit Cluster network trust", () =>
  Effect.gen(function* () {
    const profile = RedisProfiles.memorydb({ engine: "valkey", authentication: "iam" });
    expect(
      yield* Effect.flip(
        prepareNative({ url: "rediss://localhost", credentials, profile }, "cluster"),
      ),
    ).toMatchObject({ reason: "identity" });
    const source = Effect.succeed({
      username: Redacted.make("synthetic-user"),
      password: Redacted.make("synthetic-token"),
      expiresAtMillis: 100_000,
    });
    expect(
      yield* Effect.flip(
        prepareNative({ url: "rediss://localhost", credentials: source, profile }, "cluster"),
      ),
    ).toMatchObject({ reason: "network-policy" });
    const prepared = yield* prepareNative(
      {
        url: "rediss://localhost",
        credentials: source,
        profile,
        network: { allowedHosts: ["localhost"] },
      },
      "cluster",
    );
    expect(prepared.credentialLifetime).toEqual({ mode: "max-age", maxAgeMillis: 42_900_000 });
  }),
);

it.effect("Entra and Google IAM select different authenticated-socket lifetime policies", () =>
  Effect.gen(function* () {
    const source = Effect.succeed({
      username: Redacted.make("synthetic-user"),
      password: Redacted.make("synthetic-token"),
      expiresAtMillis: 100_000,
    });
    const azure = yield* prepareNative({
      url: "rediss://localhost",
      credentials: source,
      profile: RedisProfiles.azureManagedRedis({
        clustering: "enterprise",
        authentication: "entra",
      }),
    });
    const google = yield* prepareNative({
      url: "rediss://localhost",
      credentials: source,
      profile: RedisProfiles.memorystoreValkey({
        routing: "standalone",
        tls: "required",
        authentication: "iam",
      }),
    });
    expect(azure.credentialLifetime).toEqual({ mode: "token-expiry", retireBeforeMillis: 180_000 });
    expect(google.credentialLifetime).toEqual({ mode: "reconnect" });
  }),
);

it.effect(
  "module contradictions, missing mTLS identity and disabled TLS verification fail before dialing",
  () =>
    Effect.gen(function* () {
      const azure = RedisProfiles.azureManagedRedis({
        clustering: "oss",
        authentication: "password",
        modules: ["search"],
      });
      expect(
        yield* Effect.flip(
          prepareNative({ url: "rediss://localhost", credentials, profile: azure }, "cluster"),
        ),
      ).toMatchObject({ reason: "module" });
      expect(
        yield* Effect.flip(
          prepareNative({
            url: "rediss://localhost",
            profile: RedisProfiles.redisCloud({ routing: "proxy", authentication: "mtls" }),
          }),
        ),
      ).toMatchObject({ reason: "identity" });
      expect(
        yield* Effect.flip(
          prepareNative({
            endpoint: { host: "localhost", tls: { rejectUnauthorized: false } },
            credentials,
            profile: RedisProfiles.upstash({ transport: "native" }),
          }),
        ),
      ).toMatchObject({ reason: "tls" });
    }),
);
