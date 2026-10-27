import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { Context, Effect, Layer, Redacted, Schema, Schedule } from "effect";

import { deploymentHeader } from "#test/runners/providers/WorkerResponse";
import { environment } from "#test/support/providers/Case";
import { requiredSetting } from "#test/support/providers/Configuration";
import type { HttpInput } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";
import { cloudflareApi } from "#test/support/providers/workers/Api";
import {
  checkWorkerBoundary,
  waitForWorkerBoundary,
} from "#test/support/providers/workers/Boundary";
import { restorationBody } from "#test/support/providers/workers/Multipart";

const Settings = Schema.Struct({
  compatibility_date: Schema.NonEmptyString,
  compatibility_flags: Schema.optionalKey(Schema.Array(Schema.String)),
  bindings: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.String })),
});
const Policy = Schema.Struct({
  compatibilityDate: Schema.NonEmptyString,
  compatibilityFlags: Schema.Array(Schema.String),
  requestBytes: Schema.Int,
  runLifetimeMillis: Schema.Int,
});
const failure = (stage: string) =>
  new ProviderTestError({ stage, reason: "Worker fixture failed" });

const fixture = Effect.fnUntraced(function* () {
  const env = yield* environment;
  const api = cloudflareApi(env);
  const settings = yield* api.json("/settings", Settings);
  // This fixture replaces only the empty test Worker the user created, never a populated application.
  if (settings.bindings.length !== 0) return yield* failure("worker-existing-bindings");
  if (env.EFFECT_REDIS_TEST_WORKER_URL === undefined) return yield* failure("worker-url-required");
  const url = new URL(Redacted.value(env.EFFECT_REDIS_TEST_WORKER_URL));
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".workers.dev") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.startsWith(`${env.EFFECT_REDIS_TEST_WORKER_NAME}.`)
  )
    return yield* failure("worker-url-invalid");

  const response = yield* api.request("");
  const entrypoint = response.headers.get("cf-entrypoint");
  const original = yield* Effect.tryPromise({
    try: () => response.formData(),
    catch: () => failure("worker-snapshot"),
  });
  if (entrypoint === null || !original.has(entrypoint)) return yield* failure("worker-entrypoint");
  const policy = yield* Effect.promise(async () =>
    Schema.decodeUnknownSync(Policy)(
      JSON.parse(
        await readFile(new URL("../../../fixtures/runtime/workers.json", import.meta.url), "utf8"),
      ),
    ),
  );
  const directory = new URL("../../../.cache/providers/bundle/", import.meta.url);
  const modules = yield* Effect.promise(async () =>
    Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith(".js") && name !== "http.js")
        .map(async (name) => ({ name, bytes: await readFile(new URL(name, directory)) })),
    ),
  );
  const codeHash = createHash("sha256");
  for (const module of modules.toSorted((a, b) => a.name.localeCompare(b.name)))
    codeHash.update(module.name).update(module.bytes);
  const bundleSha256 = codeHash.digest("hex");
  const runKey = randomBytes(32).toString("hex");
  // This public cache nonce is deliberately independent of the bearer key.
  const probeNonce = randomBytes(16).toString("hex");
  const endpoint = (path: string) => `${url.origin}${path}?fixture=${probeNonce}`;
  const expires = Date.now() + policy.runLifetimeMillis;
  const runId = process.env.EFFECT_REDIS_PROVIDER_RUN_ID;
  const output = new URL(`../../../results/providers/${runId}/`, import.meta.url);

  const removeSecrets = Effect.gen(function* () {
    const current = yield* api.json("/settings", Settings);
    for (const name of ["RUN_KEY", "UPSTASH_TOKEN", "UPSTASH_URL"])
      if (
        current.bindings.some((binding) => binding.name === name && binding.type === "secret_text")
      )
        yield* api.json(`/secrets/${name}`, Schema.Unknown, { method: "DELETE" });
  });

  const restore = Effect.fnUntraced(function* () {
    const body = restorationBody(original, entrypoint, settings);
    // Uploads preserve omitted secrets. Remove ours even if restoring the original code fails.
    yield* api
      .json("", Schema.Unknown, { method: "PUT", body })
      .pipe(Effect.ensuring(removeSecrets.pipe(Effect.orDie)));
    const restored = yield* api.json("/settings", Settings);
    if (restored.bindings.length !== 0) return yield* failure("worker-secret-cleanup");
    const restoredResponse = yield* api.request("");
    const restoredParts = yield* Effect.promise(() => restoredResponse.formData());
    for (const [name, value] of original) {
      if (name === "metadata") continue;
      const restoredValue = restoredParts.get(name);
      if (restoredValue === null) return yield* failure("worker-code-restoration");
      const before = typeof value === "string" ? value : yield* Effect.promise(() => value.text());
      const after =
        typeof restoredValue === "string"
          ? restoredValue
          : yield* Effect.promise(() => restoredValue.text());
      if (before !== after) return yield* failure("worker-code-restoration");
    }
    yield* Effect.promise(async () => {
      await mkdir(output, { recursive: true });
      await writeFile(
        new URL("worker-cleanup.json", output),
        JSON.stringify({ restored: true, bindings: 0 }),
        { mode: 0o600 },
      );
    });
  });
  yield* Effect.addFinalizer(() => restore().pipe(Effect.orDie));

  const body = new FormData();
  body.set(
    "metadata",
    JSON.stringify({
      main_module: "worker.js",
      compatibility_date: policy.compatibilityDate,
      compatibility_flags: policy.compatibilityFlags,
      bindings: [
        {
          name: "UPSTASH_URL",
          type: "secret_text",
          text: Redacted.value(requiredSetting(env.EFFECT_REDIS_TEST_UPSTASH_REST_URL, "REST URL")),
        },
        {
          name: "UPSTASH_TOKEN",
          type: "secret_text",
          text: Redacted.value(
            requiredSetting(env.EFFECT_REDIS_TEST_UPSTASH_REST_TOKEN, "REST token"),
          ),
        },
        { name: "RUN_KEY", type: "secret_text", text: runKey },
        { name: "RUN_EXPIRES_AT", type: "plain_text", text: String(expires) },
        { name: "COMPATIBILITY_DATE", type: "plain_text", text: policy.compatibilityDate },
        { name: "VERSION", type: "version_metadata" },
      ],
    }),
  );
  for (const module of modules)
    body.set(
      module.name,
      new File([module.bytes], module.name, { type: "application/javascript+module" }),
    );
  yield* api.json("", Schema.Unknown, { method: "PUT", body });
  const deployed = yield* api.json("/settings", Settings);
  if (
    deployed.compatibility_date !== policy.compatibilityDate ||
    JSON.stringify(deployed.compatibility_flags ?? []) !== JSON.stringify(policy.compatibilityFlags)
  )
    return yield* failure("worker-compatibility-drift");

  const invoke = (path: string, input?: unknown) =>
    Effect.tryPromise({
      try: async (signal) => {
        const result = await fetch(endpoint(path), {
          method: input === undefined ? "GET" : "POST",
          signal,
          redirect: "error",
          headers: { authorization: `Bearer ${runKey}`, "content-type": "application/json" },
          ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        });
        if (!result.ok) {
          await result.body?.cancel();
          throw failure(`worker-http-${result.status}`);
        }
        return result.json() as Promise<unknown>;
      },
      catch: (error) => (error instanceof ProviderTestError ? error : failure("worker-request")),
    }).pipe(
      Effect.timeoutOrElse({
        duration: 60_000,
        orElse: () => Effect.fail(failure("worker-timeout")),
      }),
    );
  const ready = yield* invoke("/ready").pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Struct({ ready: Schema.Literal(true), version: Schema.NonEmptyString }),
      ),
    ),
    Effect.retry({ schedule: Schedule.spaced(200), times: 30 }),
    Effect.timeout(15_000),
  );
  const probes = [
    { id: "unauthorized", headers: {}, body: undefined, expected: 403 },
    {
      id: "prefix",
      headers: { authorization: `Bearer ${runKey}` },
      body: '{"scenario":"data","prefix":"shared:"}',
      expected: 400,
    },
    {
      id: "size",
      headers: { authorization: `Bearer ${runKey}` },
      body: "x".repeat(policy.requestBytes + 1),
      expected: 413,
    },
  ];
  const observations: {
    id: string;
    expected: number;
    status: number;
    deploymentMatches: boolean;
  }[] = [];
  yield* Effect.forEach(
    probes,
    (test) =>
      Effect.tryPromise({
        try: async (signal) => {
          const result = await fetch(endpoint(test.body === undefined ? "/ready" : "/test"), {
            method: test.body === undefined ? "GET" : "POST",
            signal,
            redirect: "error",
            cache: "no-store",
            headers: test.headers,
            ...(test.body === undefined ? {} : { body: test.body }),
          });
          await result.body?.cancel();
          if (observations.length < 256)
            observations.push({
              id: test.id,
              expected: test.expected,
              status: result.status,
              deploymentMatches: result.headers.get(deploymentHeader) === ready.version,
            });
          return result;
        },
        catch: () => failure(`worker-access-${test.id}-network`),
      }).pipe(
        Effect.flatMap((result) => checkWorkerBoundary(ready.version, test, result)),
        waitForWorkerBoundary,
      ),
    { concurrency: 3, discard: true },
  ).pipe(
    Effect.ensuring(
      Effect.promise(async () => {
        await mkdir(output, { recursive: true });
        await writeFile(new URL("worker-boundary.json", output), JSON.stringify(observations), {
          mode: 0o600,
        });
      }),
    ),
  );
  yield* Effect.promise(async () => {
    await mkdir(output, { recursive: true });
    await writeFile(
      new URL("worker-deployment.json", output),
      JSON.stringify(
        {
          bundleSha256,
          deployment: ready.version,
          compatibilityDate: policy.compatibilityDate,
          compatibilityFlags: policy.compatibilityFlags,
          unauthorizedRejected: true,
          sharedPrefixRejected: true,
          oversizedRejected: true,
        },
        null,
        2,
      ),
    );
  });

  return {
    invoke: (input: HttpInput) =>
      invoke("/test", { prefix: input.prefix, scenario: input.scenario }).pipe(
        Effect.tap((receipt) =>
          Schema.decodeUnknownEffect(Schema.Struct({ deployment: Schema.Literal(ready.version) }))(
            receipt,
          ),
        ),
        Effect.mapError(() => failure("worker-deployment-receipt")),
      ),
  };
});

export class HostedWorker extends Context.Service<
  HostedWorker,
  {
    readonly invoke: (input: HttpInput) => Effect.Effect<unknown, ProviderTestError>;
  }
>()("test/providers/HostedWorker") {
  static readonly layer = Layer.effect(HostedWorker, fixture());
}
