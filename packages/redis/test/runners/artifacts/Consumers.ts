import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactCommand } from "#test/runners/artifacts/Command";
import { portableGraph } from "#test/support/artifacts/Policy";

export const checkConsumers = async (
  archive: string,
  scratch: string,
  packageRoot: string,
  workspaceRoot: string,
  live = false,
) => {
  const extracted = join(scratch, "extracted");
  await mkdir(extracted);
  artifactCommand("tar", ["-xf", archive, "-C", extracted], packageRoot);
  const packed = join(extracted, "package");
  const consumer = join(scratch, "consumer");
  await mkdir(consumer);

  if (!live) {
    // The regular artifact gate stays offline; release consumers use a real npm installation.
    await mkdir(join(consumer, "node_modules/@effect-kit"), { recursive: true });
    await mkdir(join(packed, "node_modules"));
    await symlink(packed, join(consumer, "node_modules/@effect-kit/redis"), "dir");
    await symlink(
      join(workspaceRoot, "node_modules/effect"),
      join(consumer, "node_modules/effect"),
      "dir",
    );
    await symlink(
      join(workspaceRoot, "node_modules/effect"),
      join(packed, "node_modules/effect"),
      "dir",
    );
  }
  const fixture = join(packageRoot, "test/fixtures/distribution");
  await Promise.all([
    cp(join(fixture, "consumer.ts"), join(consumer, "index.ts")),
    cp(join(fixture, "runtime.mjs"), join(consumer, "runtime.mjs")),
    writeFile(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true })),
    writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          exactOptionalPropertyTypes: true,
          types: [],
          lib: ["ES2022", "DOM"],
          noEmit: true,
        },
        include: ["*.ts"],
      }),
    ),
  ]);

  if (live) {
    const effect = JSON.parse(
      await readFile(join(workspaceRoot, "node_modules/effect/package.json"), "utf8"),
    );

    artifactCommand(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--registry=https://registry.npmjs.org/",
        archive,
        `effect@${effect.version}`,
      ],
      consumer,
    );
  }

  const readmes = [join(workspaceRoot, "README.md"), join(packed, "README.md")];
  let examples = 0;

  for (const readme of readmes) {
    // Check the actual published examples rather than a second, manually synchronized copy.
    // oxlint-disable-next-line no-await-in-loop -- Each document contributes independently named consumer files.
    const markdown = await readFile(readme, "utf8");

    for (const match of markdown.matchAll(/```ts\n([\s\S]*?)```/g)) {
      // oxlint-disable-next-line no-await-in-loop -- Preserve unique, deterministic example numbering.
      await writeFile(join(consumer, `readme-${examples++}.ts`), `${match[1]}\nexport {};\n`);
    }
  }

  if (examples === 0) throw new Error("No public README examples were checked");

  artifactCommand("pnpm", ["exec", "tsc", "-p", join(consumer, "tsconfig.json")], workspaceRoot);
  const probes = [
    artifactCommand(process.execPath, ["runtime.mjs", "node"], consumer),
    artifactCommand("bun", ["--no-env-file", "--no-install", "runtime.mjs", "bun"], consumer),
  ].map((text) => JSON.parse(text));
  const manifest = JSON.parse(await readFile(join(packed, "package.json"), "utf8"));
  if (
    manifest.name !== "@effect-kit/redis" ||
    manifest.private === true ||
    manifest.dependencies !== undefined ||
    manifest.peerDependencies?.effect !== "^4.0.6" ||
    manifest.license !== "Apache-2.0" ||
    manifest.repository?.url !== "git+https://github.com/effect-kit/redis.git" ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig?.provenance !== true ||
    JSON.stringify(Object.keys(manifest.exports).toSorted()) !==
      JSON.stringify([".", "./bun", "./node", "./upstash"])
  )
    throw new Error("Unexpected package identity or runtime dependencies");

  const portable = Object.fromEntries(
    await Promise.all(
      ["index.js", "index.d.ts", "upstash.js", "upstash.d.ts"].map(async (entry) => [
        entry,
        await portableGraph(join(packed, "dist"), entry),
      ]),
    ),
  );

  const scenarios = live
    ? await (
        await import("#test/runners/artifacts/LiveConsumers")
      ).checkLiveConsumers(consumer, fixture)
    : undefined;

  return {
    typecheckWithoutNodeGlobals: true,
    readmeExamples: examples,
    portable,
    probes,
    scenarios,
  };
};
