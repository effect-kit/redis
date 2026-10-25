import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";

import { RedisConfigError } from "#/errors/RedisConfigError";
import { decodeRedisConfig } from "#/RedisConfig";

describe("CONFIG: connection configuration", () => {
  it.effect("normalizes a TLS URL and decodes credentials without retaining the URL", () =>
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig({
        endpoint: { url: "rediss://alice:p%40ss@[::1]:6380/2" },
      });
      expect(config.endpoint).toEqual({
        _tag: "Tcp",
        host: "::1",
        port: 6380,
        tls: { rejectUnauthorized: true },
      });
      expect(config.database).toBe(2);
      if (config.credentials === undefined) throw new Error("Expected credentials");
      expect(Redacted.value(config.credentials.password)).toBe("p@ss");
      if (config.credentials.username === undefined) throw new Error("Expected username");
      expect(Redacted.value(config.credentials.username)).toBe("alice");
      expect(JSON.stringify(config)).not.toContain("p@ss");
      expect(JSON.stringify(config)).not.toContain("alice");
      expect(JSON.stringify(config)).not.toContain("rediss:");
    }),
  );

  it.effect("fills bounded defaults and retains explicit settings", () =>
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
        database: 4,
      });
      expect(config.endpoint).toEqual({ _tag: "Tcp", host: "localhost", port: 6379 });
      expect(config.database).toBe(4);
      expect(config.protocol).toBe("resp2");
      expect(config.connectTimeoutMillis).toBe(10_000);
      expect(config.limits.maxQueuedCommands).toBe(1024);
      const rootPath = yield* decodeRedisConfig({ endpoint: { url: "redis://localhost/" } });
      expect(rootPath.database).toBe(0);
      const overridden = yield* decodeRedisConfig({
        endpoint: { path: "/tmp/redis.sock" },
        limits: { maxQueuedCommands: 2 },
      });
      expect(overridden.endpoint).toEqual({ _tag: "Unix", path: "/tmp/redis.sock" });
      expect(overridden.limits.maxQueuedCommands).toBe(2);
    }),
  );

  it.effect("supports explicit credentials and paired TLS client material", () =>
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig({
        endpoint: {
          host: "localhost",
          tls: { ca: "test-ca", certificate: "test-cert", privateKey: "test-key" },
        },
        credentials: { username: "test-user", password: "test-password" },
      });
      if (config.credentials === undefined) throw new Error("Expected credentials");
      expect(Redacted.value(config.credentials.password)).toBe("test-password");
      expect(JSON.stringify(config)).not.toContain("test-");
    }),
  );

  it.effect.each([
    { endpoint: { url: "http://localhost" } },
    { endpoint: { url: " redis://localhost" } },
    { endpoint: { url: "redis://local\nhost" } },
    { endpoint: { url: "redis://localhost/1?token=secret" } },
    { endpoint: { url: "redis://localhost/#fragment" } },
    { endpoint: { url: "redis://localhost/-1" } },
    { endpoint: { url: "redis://localhost/1.5" } },
    { endpoint: { url: "redis://localhost:0" } },
    { endpoint: { url: "redis://localhost:65536" } },
    { endpoint: { url: "redis://u:%GG@localhost" } },
    { endpoint: { url: "redis://localhost", tls: {} } },
    { endpoint: { host: "localhost", port: 0 } },
    { endpoint: { host: "localhost", port: 1.5 } },
    { endpoint: { host: "localhost", port: 65536 } },
    { endpoint: { host: "bad host" } },
    { endpoint: { path: "relative.sock" } },
    { endpoint: { path: "/tmp/redis.sock", host: "localhost" } },
    { endpoint: { host: "localhost", url: "redis://localhost" } },
    { endpoint: { host: "localhost", tls: { certificate: "cert" } } },
    { endpoint: { host: "localhost", tls: { privateKey: "key" } } },
    { endpoint: { host: "localhost", tls: { ca: "" } } },
    { endpoint: { host: "localhost" }, database: -1 },
    { endpoint: { host: "localhost" }, clientName: "has spaces" },
    { endpoint: { url: "redis://u:p@localhost" }, credentials: { password: "other" } },
    { endpoint: { url: "redis://localhost/1" }, database: 1 },
  ])("rejects invalid or mutually exclusive connection options %#", (input) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decodeRedisConfig(input));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(RedisConfigError);
    }),
  );

  it.effect.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid positive budgets %s",
    (value) =>
      Effect.gen(function* () {
        for (const key of [
          "maxHeaderBytes",
          "maxBlobBytes",
          "maxBufferedBytes",
          "maxAggregateEntries",
          "maxNestingDepth",
          "maxQueuedCommands",
          "maxInFlightCommands",
          "maxQueuedBytes",
          "maxInFlightBytes",
        ]) {
          expect(
            Result.isFailure(
              yield* Effect.result(
                decodeRedisConfig({ endpoint: { host: "localhost" }, limits: { [key]: value } }),
              ),
            ),
          ).toBe(true);
        }
        for (const key of ["connectTimeoutMillis", "commandTimeoutMillis"]) {
          expect(
            Result.isFailure(
              yield* Effect.result(
                decodeRedisConfig({ endpoint: { host: "localhost" }, [key]: value }),
              ),
            ),
          ).toBe(true);
        }
      }),
  );

  it.effect("rejects inconsistent parser limits", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        decodeRedisConfig({ endpoint: { host: "localhost" }, limits: { maxBufferedBytes: 32 } }),
      );
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  it.effect.each([
    { endpoint: { url: "rediss://private-user:private-password@host/invalid" } },
    {
      endpoint: { host: "localhost" },
      credentials: { password: { privateToken: "private-password" } },
    },
    { endpoint: { host: "localhost" }, privatePassword: "private-password" },
  ])("errors omit rejected inputs and unexpected field names %#", (input) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decodeRedisConfig(input));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        const diagnostic = `${result.failure}\n${JSON.stringify(result.failure)}`;
        expect(diagnostic).not.toContain("private");
        expect(diagnostic).not.toContain("rediss:");
        expect(result.failure.field.length).toBeGreaterThan(0);
      }
    }),
  );
});
