import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Redacted, Schema } from "effect";

import { NodeImage } from "../../../tools/spec/Schema.ts";
import { command } from "./Command.js";
import { allocateServer } from "./DockerServer.js";
import type { ServerTarget } from "./DockerServer.js";
import { FixtureError } from "./FixtureError.js";
import { temporaryDirectory } from "./TemporaryDirectory.js";

const images = Schema.decodeUnknownSync(Schema.NonEmptyArray(NodeImage))(
  JSON.parse(
    readFileSync(new URL("../../../../../spec/fixtures/node-images.json", import.meta.url), "utf8"),
  ),
);
const runtime = images.find((image) => image.fixture === "node");
if (runtime === undefined) throw new Error("Missing pinned Node runtime image");

/** Shares a Linux Unix socket with an actual Node process, including on macOS Docker hosts. */
export const unixRuntimeSmoke = Effect.fnUntraced(function* (target: ServerTarget) {
  const directory = yield* temporaryDirectory;
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
        fileURLToPath(new URL("../../../tools/unix-smoke.ts", import.meta.url)),
        join(directory, "tools/unix-smoke.ts"),
      );
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
    },
    catch: (cause) => new FixtureError({ stage: "unix-runtime-copy", cause: Redacted.make(cause) }),
  });
  const volume = `effect-redis-${randomUUID()}`;
  yield* Effect.acquireRelease(Effect.succeed(volume), () =>
    command("docker", ["volume", "rm", volume], true).pipe(Effect.orDie),
  );
  yield* command("docker", [
    "volume",
    "create",
    "--label",
    "effect-redis.fixture=true",
    volume,
  ]).pipe(Effect.uninterruptible);
  const server = yield* (yield* allocateServer(target, { unixVolume: volume })).start;
  const name = `effect-redis-${randomUUID()}`;
  yield* Effect.acquireRelease(Effect.succeed(name), () =>
    command("docker", ["rm", "--force", name], true).pipe(Effect.orDie),
  );
  // No network interface: the compiled adapter must really use the shared Unix socket.
  yield* command("docker", [
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    "effect-redis.fixture=true",
    "--network",
    "none",
    "--read-only",
    "--volumes-from",
    server.name,
    "--mount",
    `type=bind,src=${directory},dst=/client,readonly`,
    `${runtime.image}@${runtime.digest}`,
    "node",
    "/client/tools/unix-smoke.ts",
    "/socket/redis.sock",
  ]).pipe(Effect.uninterruptible);
  const output = yield* command("docker", ["start", "--attach", name]);
  const state = yield* command("docker", [
    "inspect",
    "--format",
    "{{.State.Running}} {{.State.ExitCode}}",
    name,
  ]);
  if (state !== "false 0") return yield* new FixtureError({ stage: "unix-runtime-exit" });
  const decoded = yield* Effect.try({
    try: (): unknown => JSON.parse(output),
    catch: () => new FixtureError({ stage: "unix-runtime-json" }),
  });
  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      node: Schema.NonEmptyString,
      transport: Schema.Literal("unix"),
      exchanges: Schema.Literal(2),
    }),
  )(decoded).pipe(Effect.mapError(() => new FixtureError({ stage: "unix-runtime-result" })));
});
