import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { providerOptions } from "#test/runners/providers/Options";
import { validateProviders } from "#test/support/providers/Configuration";
import { safeFailure } from "#test/support/providers/Failures";
import { providerCaseId, providerCases } from "#test/support/providers/Matrix";

it("requires explicit credentials and rejects accidental or empty selections", () => {
  for (const args of [
    [],
    ["--env", "--credentials-file", "private.env"],
    ["--env", "--provider", "unknown"],
    ["--env", "--provider", "aiven", "--runtime", "deno"],
    ["--env", "--case", "unknown"],
  ])
    expect(() => providerOptions(args)).toThrow();

  const options = providerOptions([
    "--credentials-file",
    "private.env",
    "--provider",
    "upstash-http",
    "--runtime",
    "deno",
  ]);
  expect(options).toMatchObject({
    envFile: "private.env",
    fromEnv: false,
    provider: "upstash-http",
    runtime: "deno",
  });
  expect(new Set(providerCases().map(providerCaseId)).size).toBe(32);
  expect(providerCases("aiven").map((scenario) => scenario.runtime)).toEqual([
    "node",
    "node",
    "bun",
    "bun",
  ]);
});

it.effect(
  "provider validation requires the independent native oracle and rejects unsafe endpoints",
  () =>
    Effect.gen(function* () {
      const http = {
        EFFECT_REDIS_TEST_UPSTASH_REST_URL: Redacted.make("https://redis.example.test"),
        EFFECT_REDIS_TEST_UPSTASH_REST_TOKEN: Redacted.make("synthetic"),
      };
      expect(yield* Effect.flip(validateProviders(http, ["upstash-http"]))).toMatchObject({
        stage: "config",
        reason: "Missing EFFECT_REDIS_TEST_UPSTASH_REDIS_URL",
      });

      const native = {
        EFFECT_REDIS_TEST_UPSTASH_REDIS_URL: Redacted.make("redis://redis.example.test"),
      };
      expect(yield* Effect.flip(validateProviders(native, ["upstash-native"]))).toMatchObject({
        stage: "config",
      });
      yield* validateProviders(
        { EFFECT_REDIS_TEST_REDIS_CLOUD_URL: Redacted.make("redis://redis.example.test") },
        ["redis-cloud-free"],
      );
      expect(
        yield* Effect.flip(
          validateProviders(
            {
              EFFECT_REDIS_TEST_AIVEN_URL: Redacted.make("rediss://redis.example.test"),
              EFFECT_REDIS_TEST_AIVEN_CA_FILE: "relative.pem",
            },
            ["aiven"],
          ),
        ),
      ).toMatchObject({ reason: "CA path must be absolute" });
    }),
);

it("diagnostics never invoke arbitrary getters or expose request bodies and credentials", () => {
  let accessed = false;
  const external = {
    _tag: "UpstashError",
    delivery: "unknown",
    url: "https://private.test",
    token: "secret",
    body: "private",
    get stage() {
      accessed = true;
      throw new Error("secret");
    },
  };

  expect(safeFailure(external)).toEqual({ _tag: "UpstashError", delivery: "unknown" });
  expect(accessed).toBe(false);
  expect(JSON.stringify(safeFailure(new Error("secret")))).not.toContain("secret");
});
