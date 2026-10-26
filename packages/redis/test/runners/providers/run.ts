import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Cause, Effect } from "effect";

import { providerOptions } from "#test/runners/providers/Options";
import { providerArtifactDigest, providerRuntimeVersions } from "#test/support/providers/Artifacts";
import {
  loadEnvironment,
  packageRoot,
  validateProviders,
  workspaceRoot,
} from "#test/support/providers/Configuration";
import { requireDeno } from "#test/support/providers/Deno";
import { certifyProviders } from "#test/support/providers/Evidence";
import { ProviderTestError, safeFailure } from "#test/support/providers/Failures";
import { providerCaseId, providerCases } from "#test/support/providers/Matrix";

const runCommand = (args: string[], env: NodeJS.ProcessEnv) => {
  const result = spawnSync("pnpm", args, { cwd: packageRoot, env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new ProviderTestError({
      stage: "runner",
      reason: `Provider command failed (${result.status ?? 1})`,
    });
};

try {
  const options = providerOptions(process.argv.slice(2).filter((arg) => arg !== "--"));
  const cases = providerCases(options.provider, options.runtime).filter(
    (scenario) => options.ids.length === 0 || options.ids.includes(providerCaseId(scenario)),
  );
  const configured = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const env = yield* loadEnvironment(options);
      yield* validateProviders(env, [...new Set(cases.map((scenario) => scenario.provider))]);
      if (cases.some((scenario) => scenario.runtime === "deno")) yield* requireDeno();
    }),
  );
  if (configured._tag === "Failure") throw Cause.squash(configured.cause);

  // Build before any live child reads dist. No credential values enter argv or bundle definitions.
  runCommand(["run", "build"], process.env);
  runCommand(["exec", "node", "test/runners/providers/bundle.ts"], process.env);
  const run = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    artifactDigest: await providerArtifactDigest(),
    runtimeVersions: await providerRuntimeVersions(),
    host: { platform: process.platform, architecture: process.arch },
  };
  const directory = resolve(packageRoot, "test/results/providers", run.runId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "run.json"),
    JSON.stringify({ ...run, cases: cases.map(providerCaseId) }, null, 2),
    { mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EFFECT_REDIS_TEST_PROVIDERS: "1",
    EFFECT_REDIS_PROVIDER_RUN_ID: run.runId,
    EFFECT_REDIS_PROVIDER_ARTIFACT_DIGEST: run.artifactDigest,
    EFFECT_REDIS_PROVIDER_SELECTION: options.provider,
    EFFECT_REDIS_PROVIDER_RUNTIME: options.runtime,
    EFFECT_REDIS_PROVIDER_CASES: JSON.stringify(options.ids),
  };
  delete env.EFFECT_REDIS_PROVIDER_ENV_FILE;
  delete env.EFFECT_REDIS_PROVIDER_FROM_ENV;
  if (options.envFile === undefined) env.EFFECT_REDIS_PROVIDER_FROM_ENV = "1";
  else env.EFFECT_REDIS_PROVIDER_ENV_FILE = resolve(workspaceRoot, options.envFile);

  runCommand(["exec", "vitest", "run", "--config", "test/vitest.live.config.ts"], env);
  if ((await providerArtifactDigest()) !== run.artifactDigest)
    throw new ProviderTestError({
      stage: "evidence",
      reason: "Code or build changed during provider verification",
    });
  const records = new Map(
    await Promise.all(
      cases.map(async (scenario) => {
        const id = providerCaseId(scenario);
        return [id, JSON.parse(await readFile(resolve(directory, `${id}.json`), "utf8"))] as const;
      }),
    ),
  );
  const certified = certifyProviders(cases, records, run);
  if (cases.some((scenario) => scenario.runtime === "workers")) {
    const cleanup: { restored?: boolean; bindings?: number } = JSON.parse(
      await readFile(resolve(directory, "worker-cleanup.json"), "utf8"),
    );
    if (cleanup.restored !== true || cleanup.bindings !== 0)
      throw new ProviderTestError({
        stage: "evidence",
        reason: "Missing Worker restoration evidence",
      });
  }
  await writeFile(
    resolve(directory, "certification.json"),
    JSON.stringify({ ...run, cases: certified }, null, 2),
    { mode: 0o600 },
  );
  process.stdout.write(
    `Certified ${certified.length} provider cases: test/results/providers/${run.runId}/certification.json\n`,
  );
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
  process.exitCode = 1;
}
