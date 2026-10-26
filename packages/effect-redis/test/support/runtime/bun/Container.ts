import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted } from "effect";

import { Wait } from "testcontainers";
import type { StartedNetwork } from "testcontainers";

import { runtimeAssets } from "#test/support/runtime/Assets";
import type { RuntimeInput } from "#test/support/runtime/bun/Input";
import { readBunReceipt } from "#test/support/runtime/bun/Process";
import {
  containerRequest,
  FixtureContainer,
  scopedContainer,
} from "#test/support/servers/Containers";
import { FixtureError } from "#test/support/servers/FixtureError";
import { bunRuntimeImage, imageReference } from "#test/support/servers/Targets";

export const runBunContainer = Effect.fnUntraced(function* (
  network: StartedNetwork,
  input: RuntimeInput,
) {
  const directory = yield* runtimeAssets;
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(join(directory, "test/support/runtime/bun"), { recursive: true });
      await mkdir(join(directory, "test/support/networking"), { recursive: true });
      await mkdir(join(directory, "test/runners"), { recursive: true });
      await cp(
        fileURLToPath(new URL("../../../runners/bun", import.meta.url)),
        join(directory, "test/runners/bun"),
        { recursive: true },
      );
      await cp(
        fileURLToPath(new URL("Input.ts", import.meta.url)),
        join(directory, "test/support/runtime/bun/Input.ts"),
      );
      await cp(
        fileURLToPath(new URL("../../networking/GatedTransport.ts", import.meta.url)),
        join(directory, "test/support/networking/GatedTransport.ts"),
      );
      await writeFile(join(directory, "input.json"), JSON.stringify(input), { mode: 0o600 });
    },
    catch: (cause) =>
      new FixtureError({ stage: "bun-container-assets", cause: Redacted.make(cause) }),
  });

  const requested = new FixtureContainer(imageReference(bunRuntimeImage))
    .withNetwork(network)
    .withBindMounts([{ source: directory, target: "/client", mode: "ro" }])
    .withCommand([
      "bun",
      "--no-env-file",
      "--no-install",
      "/client/test/runners/bun/main.ts",
      "/client/input.json",
    ])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(45_000);
  const container = yield* scopedContainer(requested);
  const output = yield* containerRequest("bun-container-receipt", async () => {
    const stream = await container.logs();
    let receipt = "";
    for await (const bytes of stream) {
      receipt += String(bytes);
      if (receipt.length > 65536) {
        stream.destroy();
        throw new Error("Bun runtime output limit");
      }
    }
    return receipt;
  });

  return yield* readBunReceipt(output, input.scenario);
});
