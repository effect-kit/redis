import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactCommand } from "#test/runners/artifacts/Command";

export const checkConsumers = async (
  archive: string,
  scratch: string,
  packageRoot: string,
  workspaceRoot: string,
) => {
  const extracted = join(scratch, "extracted");
  await mkdir(extracted);
  artifactCommand("tar", ["-xf", archive, "-C", extracted], packageRoot);
  const packed = join(extracted, "package");
  const consumer = join(scratch, "consumer");
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
        include: ["index.ts"],
      }),
    ),
  ]);
  artifactCommand("pnpm", ["exec", "tsc", "-p", join(consumer, "tsconfig.json")], workspaceRoot);
  const probes = [
    artifactCommand(process.execPath, ["runtime.mjs", "node"], consumer),
    artifactCommand("bun", ["--no-env-file", "--no-install", "runtime.mjs", "bun"], consumer),
  ].map((text) => JSON.parse(text));
  const manifest = JSON.parse(await readFile(join(packed, "package.json"), "utf8"));
  if (
    manifest.name !== "@effect-kit/redis" ||
    manifest.private !== true ||
    manifest.dependencies !== undefined ||
    manifest.peerDependencies?.effect !== "^4.0.6"
  )
    throw new Error("Unexpected package identity or runtime dependencies");
  return { typecheckWithoutNodeGlobals: true, probes };
};
