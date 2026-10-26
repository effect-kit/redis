import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { Effect, Option, Redacted, Schema } from "effect";

import { Redis } from "@effect-kit/redis";
import { RedisNode } from "@effect-kit/redis/node";

import { nativeSettings } from "#test/runners/providers/Native";
import { ensure, sameBytes } from "#test/runners/providers/scenarios/Assertions";
import { oracleBytes } from "#test/runners/providers/scenarios/Identity";
import { ownedKeys } from "#test/runners/providers/scenarios/OwnedKeys";
import { runProviderProgram } from "#test/support/providers/Child";
import { loadEnvironment, requiredSetting } from "#test/support/providers/Configuration";
import { Receipt } from "#test/support/providers/Contract";
import type { NativeInput, HttpInput } from "#test/support/providers/Contract";
import type { Observation } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";
import { hostedHttpFaults } from "#test/support/providers/HttpFaults";
import { providerCaseId } from "#test/support/providers/Matrix";
import type { ProviderCase } from "#test/support/providers/Matrix";

export const environment = loadEnvironment({
  ...(process.env.EFFECT_REDIS_PROVIDER_ENV_FILE === undefined
    ? {}
    : { envFile: process.env.EFFECT_REDIS_PROVIDER_ENV_FILE }),
  fromEnv: process.env.EFFECT_REDIS_PROVIDER_FROM_ENV === "1",
});

export const providerCase = Effect.fnUntraced(function* (
  scenario: ProviderCase,
  worker?: (input: HttpInput) => Effect.Effect<unknown, ProviderTestError>,
) {
  const env = yield* environment;
  const runId = process.env.EFFECT_REDIS_PROVIDER_RUN_ID;
  const artifactDigest = process.env.EFFECT_REDIS_PROVIDER_ARTIFACT_DIGEST;
  if (runId === undefined || !/^[a-f0-9-]{36}$/.test(runId))
    return yield* new ProviderTestError({ stage: "config", reason: "Use pnpm test:providers" });
  ensure(artifactDigest !== undefined && /^[a-f0-9]{64}$/.test(artifactDigest), "artifact-digest");
  const id = providerCaseId(scenario);
  const prefix = `effect-kit:providers:${randomUUID()}:${id}:`;
  const nativeProvider =
    scenario.provider === "aiven" || scenario.provider === "redis-cloud-free"
      ? scenario.provider
      : "upstash-native";
  const url = Redacted.value(
    requiredSetting(
      env[
        nativeProvider === "aiven"
          ? "EFFECT_REDIS_TEST_AIVEN_URL"
          : nativeProvider === "redis-cloud-free"
            ? "EFFECT_REDIS_TEST_REDIS_CLOUD_URL"
            : "EFFECT_REDIS_TEST_UPSTASH_REDIS_URL"
      ],
      "native provider URL",
    ),
  );
  const ca =
    nativeProvider === "aiven" && env.EFFECT_REDIS_TEST_AIVEN_CA_FILE
      ? yield* Effect.tryPromise({
          try: () =>
            readFile(requiredSetting(env.EFFECT_REDIS_TEST_AIVEN_CA_FILE, "CA file"), "utf8"),
          catch: () => new ProviderTestError({ stage: "config", reason: "CA file unavailable" }),
        })
      : undefined;
  const nativeInput: NativeInput = {
    provider: nativeProvider,
    protocol: scenario.protocol === "http" ? "resp2" : scenario.protocol,
    url,
    prefix,
    ...(ca === undefined ? {} : { ca }),
  };
  const receipt = yield* Effect.gen(function* () {
    const oracle = yield* Redis;
    const keys: [string, ...string[]] = [
      ...ownedKeys(prefix),
      `${prefix}oracle-in`,
      `${prefix}oracle-out`,
    ];
    yield* Effect.addFinalizer(() => oracle.del(keys).pipe(Effect.orDie));
    if (
      scenario.scenario === "extensions" ||
      (scenario.scenario === "native" && scenario.provider === "upstash-native")
    )
      yield* Effect.addFinalizer(() =>
        oracle.upstash
          .searchAliasDel(`${prefix}search-alias`)
          .pipe(Effect.andThen(oracle.upstash.searchDrop(`${prefix}search-index`)), Effect.orDie),
      );
    yield* oracle.set(`${prefix}oracle-in`, oracleBytes, { expiry: { type: "EX", value: 300 } });
    if (scenario.scenario === "batches") {
      yield* oracle.hset(`${prefix}json-hash`, [
        [oracleBytes, oracleBytes],
        ["OK", "OK"],
      ]);
      yield* oracle.expire(`${prefix}json-hash`, 300);
    }

    let received: unknown;
    let extra: Observation[] = [];
    if (scenario.scenario === "native") {
      const output = yield* runProviderProgram(
        scenario.runtime === "bun" ? "bun" : "node",
        new URL("../../runners/providers/native-main.ts", import.meta.url),
        nativeInput,
      );
      received = yield* Effect.try({
        try: () => JSON.parse(output),
        catch: () => new ProviderTestError({ stage: id, reason: "Invalid child receipt" }),
      });
    } else {
      const input = {
        url: Redacted.value(requiredSetting(env.EFFECT_REDIS_TEST_UPSTASH_REST_URL, "REST URL")),
        token: Redacted.value(
          requiredSetting(env.EFFECT_REDIS_TEST_UPSTASH_REST_TOKEN, "REST token"),
        ),
        prefix,
        scenario: scenario.scenario,
      };
      if (scenario.runtime === "workers") {
        if (worker === undefined)
          return yield* new ProviderTestError({
            stage: "workers",
            reason: "Missing scoped Worker fixture",
          });
        received = yield* worker(input);
      } else {
        const output = yield* runProviderProgram(
          scenario.runtime,
          scenario.runtime === "deno"
            ? new URL("../../.cache/providers/bundle/http.js", import.meta.url)
            : new URL("../../runners/providers/http-main.ts", import.meta.url),
          input,
        );
        received = yield* Effect.try({
          try: () => JSON.parse(output),
          catch: () => new ProviderTestError({ stage: id, reason: "Invalid child receipt" }),
        });
      }
      if (scenario.scenario === "batches" && scenario.runtime === "node")
        extra = yield* hostedHttpFaults(input, oracle);
    }
    const decoded = yield* Schema.decodeUnknownEffect(Receipt)(received).pipe(
      Effect.mapError(
        () => new ProviderTestError({ stage: id, reason: "Malformed provider decoded" }),
      ),
    );
    ensure(
      decoded.provider === scenario.provider &&
        decoded.runtime === scenario.runtime &&
        decoded.protocol === scenario.protocol &&
        decoded.scenario === scenario.scenario,
      "decoded-identity",
    );
    ensure(
      new Set(decoded.observations.map((entry) => entry.id)).size === decoded.observations.length,
      "decoded-duplicates",
    );
    const output = yield* oracle.getBytes(`${prefix}oracle-out`);
    ensure(
      Option.isSome(output) && sameBytes(output.value, oracleBytes),
      "independent-native-output",
    );
    const remaining = yield* oracle.exists(ownedKeys(prefix));
    ensure(remaining === 0n, "child-key-cleanup");
    return { ...decoded, observations: [...decoded.observations, ...extra] };
  }).pipe(Effect.scoped, Effect.provide(RedisNode.layer(nativeSettings(nativeInput))));

  const endpoint = new URL(url);
  const configurationDigest = createHash("sha256")
    .update(
      JSON.stringify({
        provider: scenario.provider,
        hostname: endpoint.hostname,
        port: endpoint.port,
        protocol: scenario.protocol,
        profile: receipt.profile,
        tls: endpoint.protocol === "rediss:",
        caDigest: ca === undefined ? null : createHash("sha256").update(ca).digest("hex"),
        httpHostname:
          scenario.protocol !== "http"
            ? null
            : new URL(
                Redacted.value(requiredSetting(env.EFFECT_REDIS_TEST_UPSTASH_REST_URL, "REST URL")),
              ).hostname,
        workerHostname:
          scenario.runtime !== "workers"
            ? null
            : new URL(
                Redacted.value(requiredSetting(env.EFFECT_REDIS_TEST_WORKER_URL, "Worker URL")),
              ).hostname,
      }),
    )
    .digest("hex");
  const record = {
    runId,
    id,
    artifactDigest,
    configurationDigest,
    observedAt: new Date().toISOString(),
    receipt,
  };
  const directory = new URL(`../../results/providers/${runId}/`, import.meta.url);
  yield* Effect.promise(async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(`${id}.json`, directory), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
  });
  return record;
});
