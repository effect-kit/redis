/* oxlint-disable no-await-in-loop -- Serialize measurements to avoid cross-runtime load and join fixture cleanup before the next cell. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { hardeningDigest, hardeningIdentity } from "#test/runners/hardening/Identity";
import { hardeningOptions } from "#test/runners/hardening/Options";
import { delayedReadiness, readinessChurn } from "#test/runners/hardening/Readiness";
import { runCase } from "#test/runners/hardening/RunCase";
import { artifactFiles } from "#test/support/artifacts/Policy";
import { budgets, certifyBenchmark, certifySoak } from "#test/support/hardening/Budgets";
import { serverTargets } from "#test/support/servers/Targets";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const options = hardeningOptions(args);
const { mode, calibration } = options;
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const directory = new URL(`../../results/hardening/${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
for (const command of [
  ["run", "fixtures:check"],
  ["run", "build"],
]) {
  const child = spawnSync("pnpm", command, { cwd: packageRoot, stdio: "inherit" });
  if (child.error || child.status !== 0) throw new Error("Hardening prerequisite failed");
}
const targets = ["redis", "valkey"].map((engine) => {
  const target = serverTargets.find((candidate) => candidate.fixture === engine);
  if (target === undefined) throw new Error("Missing primary engine fixture");
  return target;
});
const before = await artifactFiles(`${packageRoot}/dist`);
const identity = await hardeningIdentity(packageRoot);
const digest = await hardeningDigest(packageRoot);
const receipts: unknown[] = [];
const save = async (id: string, receipt: unknown) => {
  receipts.push({ id, receipt });
  await writeFile(new URL(`${id}.json`, directory), JSON.stringify(receipt, null, 2));
  process.stdout.write(`Hardening ${id} completed.\n`);
};
await writeFile(
  new URL("run.json", directory),
  JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      calibration,
      mode,
      ...identity,
      digest,
      artifacts: Object.fromEntries(before),
    },
    null,
    2,
  ),
);
if (mode === "benchmark" || mode === "all") {
  for (const target of targets)
    for (const runtime of ["node", "bun"] as const)
      for (const transport of ["tcp", "tls", "http"] as const) {
        if (!options.includes(`benchmark-${target.product}-${runtime}-${transport}`)) continue;
        process.stdout.write(`Starting benchmark ${target.product}/${runtime}/${transport}.\n`);
        const receipt = await Effect.runPromise(
          Effect.scoped(
            runCase({
              target,
              runtime,
              transport,
              mode: "benchmark",
              soakMillis: 1,
              windows: budgets.windows,
              windowMillis: budgets.windowMillis,
            }),
          ),
        );
        await save(`benchmark-${target.product}-${runtime}-${transport}`, receipt);
        if (!calibration) certifyBenchmark(receipt);
      }
}
if (mode === "soak" || mode === "all") {
  const cases = (["node", "bun"] as const)
    .flatMap((runtime, index) => {
      const target = targets[index];
      if (target === undefined) throw new Error("Missing soak target");
      return ([runtime === "node" ? "tcp" : "tls", "http"] as const).map((transport) => ({
        target,
        runtime,
        transport,
        id: `soak-${target.product}-${runtime}${transport === "http" ? "-http" : ""}`,
      }));
    })
    .filter((scenario) => options.includes(scenario.id));
  await Effect.runPromise(
    Effect.forEach(
      cases,
      (scenario) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => process.stdout.write(`Starting ${scenario.id}.\n`));
          const receipt = yield* Effect.scoped(
            runCase({
              ...scenario,
              mode: "soak",
              soakMillis: calibration ? 30_000 : budgets.soakMillis,
              windows: 1,
              windowMillis: 1,
            }),
          );
          yield* Effect.promise(() => save(scenario.id, receipt));
          if (!calibration) certifySoak(receipt);
        }),
      { concurrency: 2, discard: true },
    ),
  );
}
if (mode === "readiness" || mode === "all") {
  const redis = targets[0];
  if (redis === undefined) throw new Error("Missing delayed startup target");
  if (options.includes("readiness-delayed"))
    await save(
      "readiness-delayed",
      await Effect.runPromise(Effect.scoped(delayedReadiness(redis))),
    );
  for (const target of targets)
    if (options.includes(`readiness-${target.product}`))
      await save(
        `readiness-${target.product}`,
        await Effect.runPromise(readinessChurn(target, calibration ? 5 : 50)),
      );
}
const after = await artifactFiles(`${packageRoot}/dist`);
if (receipts.length === 0) throw new Error("Empty hardening selection");
if (JSON.stringify([...before]) !== JSON.stringify([...after]))
  throw new Error("Artifacts changed during hardening");
if ((await hardeningDigest(packageRoot)) !== digest)
  throw new Error("Hardening infrastructure changed during verification");
await writeFile(
  new URL("complete.json", directory),
  JSON.stringify(
    {
      calibration,
      completedAt: new Date().toISOString(),
      certified: !calibration,
      budgetVersion: budgets.version,
      digest,
      cases: receipts.map((receipt) => (receipt as { id: string }).id),
    },
    null,
    2,
  ),
);
process.stdout.write(`Hardening evidence: ${fileURLToPath(directory)}\n`);
