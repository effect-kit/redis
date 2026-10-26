import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";

import { ProviderTestError } from "#test/support/providers/Failures";
import { command } from "#test/support/servers/Command";

const Manifest = Schema.Struct({
  version: Schema.NonEmptyString,
  assets: Schema.NonEmptyArray(
    Schema.Struct({
      target: Schema.NonEmptyString,
      url: Schema.NonEmptyString,
      sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    }),
  ),
});

export const denoTarget = (platform = process.platform, architecture = process.arch) => {
  if (!["darwin", "linux"].includes(platform) || !["arm64", "x64"].includes(architecture))
    throw new ProviderTestError({ stage: "deno", reason: "Unsupported runtime platform" });
  return `${architecture === "arm64" ? "aarch64" : "x86_64"}-${platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
};

export const denoInstallation = Effect.fnUntraced(function* () {
  const manifest = yield* Effect.tryPromise({
    try: async () =>
      Schema.decodeUnknownSync(Manifest)(
        JSON.parse(
          await readFile(new URL("../../fixtures/runtime/deno.json", import.meta.url), "utf8"),
        ),
      ),
    catch: () =>
      new ProviderTestError({ stage: "deno", reason: "Invalid pinned runtime manifest" }),
  });
  const versionFile = yield* Effect.promise(() =>
    readFile(new URL("../../../../../.deno-version", import.meta.url), "utf8"),
  );
  if (versionFile.trim() !== manifest.version)
    return yield* new ProviderTestError({
      stage: "deno",
      reason: "Runtime version files disagree",
    });

  const target = denoTarget();
  const asset = manifest.assets.find((entry) => entry.target === target);
  if (
    asset === undefined ||
    asset.url !==
      `https://github.com/denoland/deno/releases/download/v${manifest.version}/deno-${target}.zip`
  )
    return yield* new ProviderTestError({
      stage: "deno",
      reason: "Invalid runtime download target",
    });

  const directory = fileURLToPath(
    new URL(`../../.cache/deno/${manifest.version}/${target}/`, import.meta.url),
  );
  return { ...asset, version: manifest.version, directory, binary: join(directory, "deno") };
});

export const requireDeno = Effect.fnUntraced(function* () {
  const installation = yield* denoInstallation();
  const version = yield* command(installation.binary, ["--version"]).pipe(
    Effect.mapError(
      () => new ProviderTestError({ stage: "deno", reason: "Run pnpm providers:prepare first" }),
    ),
  );
  if (
    version.split("\n", 1)[0] !==
      `deno ${installation.version} (stable, release, ${installation.target})` &&
    !version.startsWith(`deno ${installation.version} `)
  )
    return yield* new ProviderTestError({ stage: "deno", reason: "Unexpected runtime version" });
  return installation;
});

/** An explicit preparation command downloads a reviewed archive; test execution never installs runtimes. */
export const prepareDeno = Effect.fnUntraced(function* () {
  const installation = yield* denoInstallation();
  const temporary = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "effect-kit-deno-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const archive = join(temporary, "deno.zip");
  const bytes = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(installation.url, { signal, redirect: "follow" });
      if (!response.ok || Number(response.headers.get("content-length")) > 128 * 1024 * 1024)
        throw new Error("Invalid runtime download");
      const downloaded = new Uint8Array(await response.arrayBuffer());
      if (downloaded.length > 128 * 1024 * 1024) throw new Error("Invalid runtime download");
      return downloaded;
    },
    catch: () => new ProviderTestError({ stage: "deno", reason: "Runtime download failed" }),
  }).pipe(Effect.timeout(120_000));
  if (createHash("sha256").update(bytes).digest("hex") !== installation.sha256)
    return yield* new ProviderTestError({
      stage: "deno",
      reason: "Runtime archive checksum mismatch",
    });

  yield* Effect.promise(() => writeFile(archive, bytes, { mode: 0o600 }));
  yield* command("unzip", ["-qq", archive, "-d", temporary]);
  yield* Effect.promise(async () => {
    await mkdir(installation.directory, { recursive: true });
    await chmod(join(temporary, "deno"), 0o755);
    await rename(join(temporary, "deno"), installation.binary);
  });
  return yield* requireDeno();
});
