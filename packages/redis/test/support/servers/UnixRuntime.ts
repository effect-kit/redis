import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted, Schema } from "effect";

import { Wait } from "testcontainers";

import { runtimeAssets } from "#test/support/runtime/Assets";
import {
  containerRequest,
  FixtureContainer,
  scopedContainer,
  sharedVolume,
} from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import type { ServerTarget } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { bunRuntimeImage, imageReference, runtimeImage } from "#test/support/servers/Targets";

/** Shares a Linux Unix socket with an actual runtime, including on macOS Docker hosts. */
export const unixRuntimeSmoke = Effect.fnUntraced(function* (
  target: ServerTarget,
  program: "bytes" | "connection" | "bun" = "bytes",
) {
  const directory = yield* runtimeAssets;
  const script =
    program === "bun"
      ? "unix-bun.ts"
      : program === "bytes"
        ? "unix-bytes.ts"
        : "unix-connection.ts";

  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(join(directory, "test/runners/probes"), { recursive: true });
      await cp(
        fileURLToPath(new URL(`../../runners/probes/${script}`, import.meta.url)),
        join(directory, `test/runners/probes/${script}`),
      );
    },
    catch: (cause) => new FixtureError({ stage: "unix-runtime-copy", cause: Redacted.make(cause) }),
  });

  const volume = yield* sharedVolume;
  yield* (yield* allocateServer(target, { unixVolume: volume })).start;

  const container = new FixtureContainer(
    imageReference(program === "bun" ? bunRuntimeImage : runtimeImage),
  )
    .withNetworkMode("none")
    .withBindMounts([{ source: directory, target: "/client", mode: "ro" }])
    .sharedVolume(volume, "/socket")
    .withCommand([
      ...(program === "bun" ? ["bun", "--no-env-file", "--no-install"] : ["node"]),
      `/client/test/runners/probes/${script}`,
      "/socket/redis.sock",
    ])
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
    Schema.Union([
      Schema.Struct({
        node: Schema.NonEmptyString,
        transport: Schema.Literal("unix"),
        exchanges: Schema.Literal(2),
        engine: Schema.optionalKey(Schema.Literal(true)),
      }),
      Schema.Struct({
        bun: Schema.Literal(bunRuntimeImage.version),
        platform: Schema.Literal("linux"),
        architecture: Schema.Literals(["arm64", "x64"]),
        transport: Schema.Literal("unix"),
        exchanges: Schema.Literal(2),
        engine: Schema.Literal(true),
      }),
    ]),
  )(decoded).pipe(Effect.mapError(() => new FixtureError({ stage: "unix-runtime-result" })));
});
