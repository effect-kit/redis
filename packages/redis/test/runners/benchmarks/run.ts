/* oxlint-disable no-await-in-loop -- Serialize trials and own each child's exit before the next measurement. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";

import { artifactCommand } from "#test/runners/artifacts/Command";
import {
  benchmarkOptions,
  clients,
  executions,
  rotateClients,
  workloads,
} from "#test/runners/benchmarks/Options";
import { cellId, Receipt, summarize, summaryCsv } from "#test/runners/benchmarks/Results";
import type { Cell } from "#test/runners/benchmarks/Results";
import { artifactFiles } from "#test/support/artifacts/Policy";
import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { dockerServer } from "#test/support/servers/DockerServer";
import { serverTargets } from "#test/support/servers/Targets";

const options = benchmarkOptions(process.argv.slice(2));
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = new URL(`../../results/benchmarks/${randomUUID()}/`, import.meta.url);
const selectedClients = clients.filter(
  (client) => options.client === "all" || client === options.client,
);
const selectedExecutions = executions.filter(
  (execution) => options.execution === "all" || execution === options.execution,
);
const selectedWorkloads = workloads.filter(
  (workload) => options.workload === "all" || workload.name === options.workload,
);
const targets = ["redis", "valkey"]
  .filter((engine) => options.engine === "all" || engine === options.engine)
  .map((engine) => {
    const target = serverTargets.find((candidate) => candidate.fixture === engine);
    if (target === undefined) throw new Error(`Missing fixture ${engine}`);
    return target;
  });
const expected = targets.flatMap((target) =>
  selectedExecutions.flatMap((execution) =>
    selectedWorkloads.flatMap((workload) =>
      Array.from({ length: options.trials }, (_, trial) =>
        selectedClients.map(
          (client) => `${target.product}/${execution}/${workload.name}/${trial}/${client}`,
        ),
      ).flat(),
    ),
  ),
);

if (
  process.versions.node !==
  (await readFile(new URL("../../../../../.node-version", import.meta.url), "utf8")).trim()
)
  throw new Error("Use the pinned Node version");

artifactCommand("pnpm", ["run", "fixtures:check"], packageRoot);
artifactCommand("pnpm", ["run", "build"], packageRoot);

const digest = async () => {
  const hash = createHash("sha256");
  for (const root of [
    "dist",
    "test/runners/benchmarks",
    "test/support",
    "test/fixtures/backends",
  ]) {
    for (const [path, content] of await artifactFiles(`${packageRoot}/${root}`))
      hash.update(`${root}/${path}\0${content}\n`);
  }
  for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    hash.update(await readFile(new URL(`../../../../../${path}`, import.meta.url)));
  hash.update(await readFile(new URL("../../../package.json", import.meta.url)));
  return hash.digest("hex");
};
const sourceDigest = await digest();
await mkdir(output, { recursive: true });
const cells: Cell[] = [];
await writeFile(
  new URL("run.json", output),
  JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      options,
      expected,
      sourceDigest,
      commit: artifactCommand("git", ["rev-parse", "HEAD"], packageRoot).trim(),
      workingTreeClean:
        artifactCommand("git", ["status", "--porcelain"], packageRoot).trim() === "",
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      kernel: release(),
      loadModel:
        "closed-loop; latency includes client scheduling, response normalization and validation",
      protocol: "RESP2",
      transport: "loopback TCP to owned Docker fixture",
      latencySamples:
        "exact, bounded at 2 million; percentiles summarized as medians of per-trial percentiles",
    },
    null,
    2,
  ),
);
process.stdout.write(`Benchmark evidence: ${fileURLToPath(output)}\n`);

try {
  for (const target of targets) {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* dockerServer(target);
          yield* Effect.promise(() =>
            writeFile(
              new URL(`${target.product}-server.json`, output),
              JSON.stringify(
                {
                  image: target.reference,
                  build: server.build,
                  configurationDigest: server.configurationDigest,
                },
                null,
                2,
              ),
            ),
          );

          for (const execution of selectedExecutions) {
            for (const workload of selectedWorkloads) {
              for (let trial = 0; trial < options.trials; trial++) {
                for (const client of rotateClients(selectedClients, trial)) {
                  const input = {
                    client,
                    execution,
                    workload: workload.name,
                    port: server.port,
                    prefix: `effect-kit:benchmark:${randomUUID()}:`,
                    warmupMillis: options.warmupMillis,
                    sampleMillis: options.sampleMillis,
                  };
                  yield* Effect.sync(() =>
                    process.stdout.write(
                      `${target.product}/${execution}/${workload.name}/${trial + 1}/${client}\n`,
                    ),
                  );
                  const raw = yield* runRuntimeProgram({
                    runtime: "node",
                    program: new URL("main.ts", import.meta.url),
                    input: JSON.stringify(input),
                    exposeGc: true,
                    transformTypes: true,
                    timeout: options.warmupMillis + options.sampleMillis + 30_000,
                    stage: "client-benchmark",
                  });
                  const receipt = yield* Schema.decodeUnknownEffect(Receipt)(JSON.parse(raw));
                  if (
                    receipt.client !== client ||
                    receipt.execution !== execution ||
                    receipt.workload !== workload.name ||
                    receipt.node !== process.versions.node
                  )
                    return yield* Effect.die(new Error("Benchmark child identity mismatch"));

                  const measurement = receipt.measurement;
                  if (
                    measurement.elapsedMillis < options.sampleMillis ||
                    measurement.latency.count !== measurement.operations ||
                    measurement.commands !== measurement.operations * workload.commands
                  )
                    return yield* Effect.die(
                      new Error("Benchmark measurement count or duration mismatch"),
                    );

                  const cell = { engine: target.product, trial, receipt };
                  cells.push(cell);
                  yield* Effect.promise(() =>
                    writeFile(
                      new URL(`${cellId(cell).replaceAll("/", "-")}.json`, output),
                      JSON.stringify(cell, null, 2),
                    ),
                  );
                }
              }
            }
          }
        }),
      ),
    );
  }

  if ((await digest()) !== sourceDigest)
    throw new Error("Benchmark code or artifacts changed during measurement");
  const summary = summarize(cells, expected);
  await writeFile(new URL("summary.csv", output), summaryCsv(summary));
  await writeFile(
    new URL("complete.json", output),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        sourceDigest,
        measurements: cells.length,
        summary,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `Completed ${cells.length} measurements. Results: ${fileURLToPath(new URL("summary.csv", output))}\n`,
  );
} catch (cause) {
  await writeFile(
    new URL("failure.json", output),
    JSON.stringify(
      {
        failedAt: new Date().toISOString(),
        completed: cells.map(cellId),
        error: cause instanceof Error ? cause.message : String(cause),
      },
      null,
      2,
    ),
  );
  throw cause;
}
