import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { Schema } from "effect";

import { artifactCommand } from "#test/runners/artifacts/Command";
import { checkConsumers } from "#test/runners/artifacts/Consumers";
import {
  packageRoot,
  readReleaseArchive,
  releaseOptions,
  workspaceRoot,
} from "#test/runners/artifacts/ReleaseArchive";
import { archiveIntegrity } from "#test/support/artifacts/ReleasePlan";

const options = releaseOptions();
const candidate = await readReleaseArchive(options["pack-dir"]);
const scratch = await mkdtemp(join(tmpdir(), "effect-kit-registry-"));

try {
  const specifier = `${candidate.name}@${candidate.version}`;
  const registry = "--registry=https://registry.npmjs.org/";
  const metadata = JSON.parse(
    artifactCommand("npm", ["view", specifier, "--json", registry], scratch),
  );

  if (
    metadata.name !== candidate.name ||
    metadata.version !== candidate.version ||
    metadata.dist?.integrity !== candidate.integrity ||
    (options.provenance &&
      (typeof metadata.dist?.attestations?.url !== "string" ||
        typeof metadata.dist?.attestations?.provenance?.predicateType !== "string"))
  )
    throw new Error("Registry identity, integrity or required provenance does not match");

  const packages = join(scratch, "packages");
  await mkdir(packages);

  const receipts = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ filename: Schema.NonEmptyString })),
  )(
    JSON.parse(
      artifactCommand(
        "npm",
        ["pack", specifier, "--ignore-scripts", "--json", "--pack-destination", packages, registry],
        scratch,
      ),
    ),
  );
  const filename = receipts[0]?.filename;

  if (receipts.length !== 1 || filename === undefined || basename(filename) !== filename)
    throw new Error("Unexpected registry archive receipt");

  const archive = join(packages, filename);

  if (archiveIntegrity(await readFile(archive), "sha512") !== candidate.integrity)
    throw new Error("Registry archive bytes differ from the verified candidate");

  const consumers = await checkConsumers(archive, scratch, packageRoot, workspaceRoot, true);

  await writeFile(
    join(options["pack-dir"], "registry-verification.json"),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        name: candidate.name,
        version: candidate.version,
        integrity: candidate.integrity,
        provenance: metadata.dist.attestations?.provenance ?? null,
        consumers,
      },
      null,
      2,
    ),
  );

  process.stdout.write(`Registry consumers verified: ${specifier}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
