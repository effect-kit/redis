import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { decodeSentinelConfig } from "#/sentinel/Config";
import { decodeSentinelPolicy } from "#/sentinel/Options";

it.effect(
  "Sentinel configuration preserves independent discovery/data identities and database",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeSentinelConfig({
        serviceName: "cache",
        sentinels: [{ endpoint: { host: "s1" }, credentials: { password: "control-secret" } }],
        data: { database: 5, credentials: { password: "data-secret" } },
      });

      const control = config.sentinels[0].credentials;
      const data = config.data.credentials;
      if (control === undefined || data === undefined)
        return yield* Effect.die("Missing decoded test credentials");

      expect(config.data.database).toBe(5);
      expect(config.sentinels[0].endpoint).toMatchObject({ host: "s1", port: 26379 });
      expect(Redacted.value(control.password)).toBe("control-secret");
      expect(Redacted.value(data.password)).toBe("data-secret");
      expect(JSON.stringify(config)).not.toContain("control-secret");
      expect(JSON.stringify(config)).not.toContain("data-secret");
    }),
);

it.effect.each([
  { serviceName: "", sentinels: [{ endpoint: { host: "s1" } }] },
  { serviceName: "cache", sentinels: [] },
  { serviceName: "cache", sentinels: [{ endpoint: { host: "s1" }, database: 1 }] },
  { serviceName: "cache", sentinels: [{ endpoint: { path: "/tmp/sentinel.sock" } }] },
  {
    serviceName: "cache",
    sentinels: [{ endpoint: { host: "s1" } }],
    data: { endpoint: { host: "bypass" } },
  },
])("invalid Sentinel identity/configuration fails without exposing rejected input %#", (input) =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(decodeSentinelConfig(input)))._tag).toBe("RedisConfigError");
  }),
);

it.effect.each([
  { maxSentinels: 0 },
  { maxOperations: -1 },
  { discoveryAttempts: 11 },
  { readPreference: "strong" },
])("Sentinel policy rejects unbounded/unknown choices %#", (input) =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(decodeSentinelPolicy(input)))._tag).toBe("RedisConfigError");
  }),
);

it.effect(
  "typed data TLS options accept validated Redacted identities without decoding secrets twice",
  () =>
    Effect.gen(function* () {
      const policy = yield* decodeSentinelPolicy({
        dataTls: { ca: Redacted.make("synthetic-ca"), rejectUnauthorized: true },
      });

      expect(policy.dataTls?.ca === undefined ? undefined : Redacted.value(policy.dataTls.ca)).toBe(
        "synthetic-ca",
      );
      expect(JSON.stringify(policy)).not.toContain("synthetic-ca");
    }),
);

it.effect("Sentinel URL defaults use 26379 while explicit data/control ports stay unchanged", () =>
  Effect.gen(function* () {
    const config = yield* decodeSentinelConfig({
      serviceName: "cache",
      sentinels: [
        { endpoint: { url: "redis://s1" } },
        { endpoint: { url: "redis://s2:6379" } },
        { endpoint: { host: "s3", port: 12345 } },
      ],
    });

    expect(config.sentinels.map((sentinel) => sentinel.endpoint)).toMatchObject([
      { host: "s1", port: 26379 },
      { host: "s2", port: 6379 },
      { host: "s3", port: 12345 },
    ]);
  }),
);
