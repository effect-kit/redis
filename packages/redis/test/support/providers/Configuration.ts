import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { Effect, Redacted, Schema } from "effect";

import type { Provider as ProviderId } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";

export const workspaceRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
export const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const Secret = Schema.RedactedFromValue(Schema.NonEmptyString);
const Environment = Schema.Struct({
  EFFECT_REDIS_TEST_UPSTASH_REST_URL: Schema.optionalKey(Secret),
  EFFECT_REDIS_TEST_UPSTASH_REST_TOKEN: Schema.optionalKey(Secret),
  EFFECT_REDIS_TEST_UPSTASH_REDIS_URL: Schema.optionalKey(Secret),
  EFFECT_REDIS_TEST_AIVEN_URL: Schema.optionalKey(Secret),
  EFFECT_REDIS_TEST_AIVEN_CA_FILE: Schema.optionalKey(Schema.String),
  EFFECT_REDIS_TEST_REDIS_CLOUD_URL: Schema.optionalKey(Secret),
  CLOUDFLARE_ACCOUNT_ID: Schema.optionalKey(Secret),
  CLOUDFLARE_API_TOKEN: Schema.optionalKey(Secret),
  EFFECT_REDIS_TEST_WORKER_NAME: Schema.optionalKey(Schema.NonEmptyString),
  EFFECT_REDIS_TEST_WORKER_URL: Schema.optionalKey(Secret),
});
export type ProviderEnvironment = typeof Environment.Type;

export const requiredSetting = <A>(value: A | undefined, key: string): A => {
  if (value === undefined)
    throw new ProviderTestError({ stage: "config", reason: `Missing ${key}` });
  return value;
};

/** Loading a credentials file is explicit; normal tests never search for developer endpoints. */
export const loadEnvironment = Effect.fnUntraced(function* (source: {
  readonly envFile?: string;
  readonly fromEnv?: boolean;
}) {
  if ((source.envFile === undefined) === (source.fromEnv !== true))
    return yield* new ProviderTestError({ stage: "config", reason: "Choose env-file or env" });

  const envFile = source.envFile;
  const input =
    envFile === undefined
      ? process.env
      : yield* Effect.tryPromise({
          try: async () => parseEnv(await readFile(resolve(workspaceRoot, envFile), "utf8")),
          catch: () =>
            new ProviderTestError({ stage: "config", reason: "Credentials file unavailable" }),
        });
  const nonempty = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ""));
  return yield* Schema.decodeUnknownEffect(Environment)(nonempty).pipe(
    Effect.mapError(
      () => new ProviderTestError({ stage: "config", reason: "Invalid provider configuration" }),
    ),
  );
});

export const validateProviders = (
  env: ProviderEnvironment,
  providers: ReadonlyArray<ProviderId>,
) => {
  const required = new Set<keyof ProviderEnvironment>();
  for (const provider of providers) {
    if (provider === "upstash-native") required.add("EFFECT_REDIS_TEST_UPSTASH_REDIS_URL");
    if (provider === "aiven") required.add("EFFECT_REDIS_TEST_AIVEN_URL");
    if (provider === "redis-cloud-free") required.add("EFFECT_REDIS_TEST_REDIS_CLOUD_URL");
    if (provider === "upstash-http" || provider === "workers") {
      required.add("EFFECT_REDIS_TEST_UPSTASH_REDIS_URL");
      required.add("EFFECT_REDIS_TEST_UPSTASH_REST_URL");
      required.add("EFFECT_REDIS_TEST_UPSTASH_REST_TOKEN");
    }
    if (provider === "workers") {
      required.add("CLOUDFLARE_ACCOUNT_ID");
      required.add("CLOUDFLARE_API_TOKEN");
      required.add("EFFECT_REDIS_TEST_WORKER_NAME");
      required.add("EFFECT_REDIS_TEST_WORKER_URL");
    }
  }
  for (const key of required) {
    if (env[key] === undefined)
      return Effect.fail(new ProviderTestError({ stage: "config", reason: `Missing ${key}` }));
  }

  for (const [key, expected] of [
    ["EFFECT_REDIS_TEST_UPSTASH_REST_URL", "https:"],
    ["EFFECT_REDIS_TEST_UPSTASH_REDIS_URL", "rediss:"],
    ["EFFECT_REDIS_TEST_AIVEN_URL", "rediss:"],
    ["EFFECT_REDIS_TEST_REDIS_CLOUD_URL", "redis:"],
  ] as const) {
    const secret = env[key];
    if (!required.has(key) || secret === undefined) continue;
    try {
      const url = new URL(Redacted.value(secret));
      if (url.protocol !== expected || url.hostname === "" || url.hash !== "" || url.search !== "")
        throw new Error("Invalid provider URL");
      if (
        expected === "https:" &&
        (url.username !== "" || url.password !== "" || url.pathname !== "/")
      )
        throw new Error("Invalid HTTP provider URL");
    } catch {
      return Effect.fail(new ProviderTestError({ stage: "config", reason: `Invalid ${key}` }));
    }
  }
  if (env.EFFECT_REDIS_TEST_AIVEN_CA_FILE && !isAbsolute(env.EFFECT_REDIS_TEST_AIVEN_CA_FILE))
    return Effect.fail(
      new ProviderTestError({ stage: "config", reason: "CA path must be absolute" }),
    );
  if (
    providers.includes("workers") &&
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.EFFECT_REDIS_TEST_WORKER_NAME ?? "")
  )
    return Effect.fail(new ProviderTestError({ stage: "config", reason: "Invalid Worker name" }));

  return Effect.void;
};
