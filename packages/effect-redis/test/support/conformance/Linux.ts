import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted } from "effect";

import { Wait } from "testcontainers";
import type { StartedNetwork } from "testcontainers";

import type { Input } from "#test/support/conformance/Contract";
import { runtimeAssets } from "#test/support/runtime/Assets";
import {
  containerRequest,
  FixtureContainer,
  scopedContainer,
} from "#test/support/servers/Containers";
import { FixtureError } from "#test/support/servers/FixtureError";
import { runtimeImage, bunRuntimeImage, imageReference } from "#test/support/servers/Targets";

/** The same public-artifact scenarios run inside the pinned Linux runtime, without mounting source. */
export const runLinux = Effect.fnUntraced(function* (
  runtime: "node" | "bun",
  network: StartedNetwork,
  input: Input,
) {
  const directory = yield* runtimeAssets;
  yield* Effect.tryPromise({
    try: async () => {
      await Promise.all(
        [
          "test/runners",
          "test/support/conformance",
          "test/support/client",
          "test/support/networking",
        ].map((folder) => mkdir(join(directory, folder), { recursive: true })),
      );
      await cp(
        fileURLToPath(new URL("../../runners/conformance", import.meta.url)),
        join(directory, "test/runners/conformance"),
        { recursive: true },
      );
      await Promise.all(
        ["Contract.ts", "Domains.ts", "expectations"].map((path) =>
          cp(
            fileURLToPath(new URL(path, import.meta.url)),
            join(directory, "test/support/conformance", path),
            { recursive: true },
          ),
        ),
      );
      await cp(
        fileURLToPath(new URL("../client/Input.ts", import.meta.url)),
        join(directory, "test/support/client/Input.ts"),
      );
      await writeFile(join(directory, "input.json"), JSON.stringify(input), { mode: 0o600 });
      await cp(
        fileURLToPath(new URL("../networking/GatedTransport.ts", import.meta.url)),
        join(directory, "test/support/networking/GatedTransport.ts"),
      );
    },
    catch: (cause) =>
      new FixtureError({ stage: "conformance-linux-assets", cause: Redacted.make(cause) }),
  });

  const requested = new FixtureContainer(
    imageReference(runtime === "node" ? runtimeImage : bunRuntimeImage),
  )
    .withNetwork(network)
    .withBindMounts([{ source: directory, target: "/client", mode: "ro" }])
    .withEntrypoint([runtime])
    .withCommand([
      ...(runtime === "bun" ? ["--no-env-file", "--no-install"] : []),
      "/client/test/runners/conformance/main.ts",
      "/client/input.json",
    ])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(45_000);
  const container = yield* scopedContainer(requested);

  return yield* containerRequest("conformance-linux-receipt", async () => {
    const stream = await container.logs();
    let output = "";
    for await (const bytes of stream) {
      output += String(bytes);
      if (output.length > 65536) {
        stream.destroy();
        throw new Error("Conformance Linux output limit");
      }
    }
    return output;
  });
});
