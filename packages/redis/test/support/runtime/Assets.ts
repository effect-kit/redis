import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";

/** Freeze the compiled client and its only runtime peer before a container mounts them. */
export const runtimeAssets = Effect.gen(function* () {
  const directory = yield* temporaryDirectory;

  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(join(directory, "node_modules/effect"), { recursive: true });
      await cp(fileURLToPath(new URL("../../../dist", import.meta.url)), join(directory, "dist"), {
        recursive: true,
      });
      const effect = new URL("../../../node_modules/effect/", import.meta.url);
      await cp(
        fileURLToPath(new URL("dist", effect)),
        join(directory, "node_modules/effect/dist"),
        { recursive: true },
      );
      await cp(
        fileURLToPath(new URL("package.json", effect)),
        join(directory, "node_modules/effect/package.json"),
      );
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ type: "module", imports: { "#test/*": "./test/*.ts" } }),
      );
    },
    catch: (cause) => new FixtureError({ stage: "runtime-assets", cause: Redacted.make(cause) }),
  });

  return directory;
});
