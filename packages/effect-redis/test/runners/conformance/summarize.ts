import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { certifyRecords } from "#test/support/conformance/Evidence";
import { caseId, requiredCases } from "#test/support/conformance/Matrix";

const directory = new URL("../../results/", import.meta.url);
const runId = process.env.EFFECT_REDIS_TEST_RUN_ID;
if (runId === undefined)
  throw new Error("Use pnpm test:live to produce fresh conformance evidence");
const expected = requiredCases();
if (expected.length === 0) throw new Error("No conformance scenarios selected");
const records = new Map(
  await Effect.runPromise(
    Effect.forEach(
      expected,
      (scenario) =>
        Effect.promise(async () => {
          const id = caseId(scenario);
          return [
            id,
            JSON.parse(await readFile(new URL(`${id}.json`, directory), "utf8")),
          ] as const;
        }),
      { concurrency: 16 },
    ),
  ),
);
const cases = certifyRecords(expected, records, runId);

const artifactRoot = new URL("../../../dist/", import.meta.url);
const artifactPaths = (await readdir(artifactRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .toSorted();
const hash = createHash("sha256");
const artifacts = await Effect.runPromise(
  Effect.forEach(
    artifactPaths,
    (path) =>
      Effect.promise(
        async () => [relative(fileURLToPath(artifactRoot), path), await readFile(path)] as const,
      ),
    { concurrency: 16 },
  ),
);
for (const [name, bytes] of artifacts) hash.update(name).update(bytes);

const observations = { passed: 0, "expected-unsupported": 0, different: 0 };
for (const { receipt } of cases)
  for (const row of receipt.observations) observations[row.outcome]++;

const summary = {
  runId,
  generatedAt: new Date().toISOString(),
  clientBuildSha256: hash.digest("hex"),
  scope:
    "Exact recorded scenarios only; accepted command names do not establish semantic or option parity.",
  caseCount: cases.length,
  observations,
  cases,
};
await writeFile(
  new URL("engine-conformance.json", directory),
  `${JSON.stringify(summary, null, 2)}\n`,
);
process.stdout.write(
  `Engine conformance: ${cases.length} exact cases; ${JSON.stringify(summary.observations)}\n`,
);
