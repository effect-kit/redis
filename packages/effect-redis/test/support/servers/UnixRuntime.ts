import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted, Schema } from "effect";

import { Wait } from "testcontainers";

import {
  containerRequest,
  FixtureContainer,
  scopedContainer,
  sharedVolume,
} from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import type { ServerTarget } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";
import { imageReference, runtimeImage } from "#tools/FixtureTargets";

/** Shares a Linux Unix socket with an actual Node process, including on macOS Docker hosts. */
export const unixRuntimeSmoke = Effect.fnUntraced(function* (
  target: ServerTarget,
  program: "bytes" | "connection" = "bytes",
) {
  const directory = yield* temporaryDirectory;
  const script = program === "bytes" ? "unix-smoke.ts" : "connection-unix-smoke.ts";

  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(join(directory, "tools"));
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
      await cp(
        fileURLToPath(new URL(`../../../tools/${script}`, import.meta.url)),
        join(directory, `tools/${script}`),
      );
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
    },
    catch: (cause) => new FixtureError({ stage: "unix-runtime-copy", cause: Redacted.make(cause) }),
  });

  const volume = yield* sharedVolume;
  yield* (yield* allocateServer(target, { unixVolume: volume })).start;

  const container = new FixtureContainer(imageReference(runtimeImage))
    .withNetworkMode("none")
    .withBindMounts([{ source: directory, target: "/client", mode: "ro" }])
    .sharedVolume(volume, "/socket")
    .withCommand(["node", `/client/tools/${script}`, "/socket/redis.sock"])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(15_000);

  const started = yield* scopedContainer(container);
  const response = yield* containerRequest("unix-runtime-output", async () => {
    const stream = await started.logs();
    let output = "";

    for await (const chunk of stream) {
      output += String(chunk);
      if (output.length > 4096) {
        stream.destroy();
        throw new Error("Runtime output limit");
      }
    }

    return output;
  });

  const decoded = yield* Effect.try({
    try: (): unknown => JSON.parse(response),
    catch: () => new FixtureError({ stage: "unix-runtime-json" }),
  });

  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      node: Schema.NonEmptyString,
      transport: Schema.Literal("unix"),
      exchanges: Schema.Literal(2),
      engine: Schema.optionalKey(Schema.Literal(true)),
    }),
  )(decoded).pipe(Effect.mapError(() => new FixtureError({ stage: "unix-runtime-result" })));
});
