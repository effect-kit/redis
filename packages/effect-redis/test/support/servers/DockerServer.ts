import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted, Schedule, Schema } from "effect";

import { NativeFixture, NodeImage } from "../../../tools/spec/Schema.ts";
import type { Certificates } from "../tls/Certificates.js";
import { command } from "./Command.js";
import { FixtureError } from "./FixtureError.js";
import { probe } from "./Readiness.js";
import { temporaryDirectory } from "./TemporaryDirectory.js";

const images = Schema.decodeUnknownSync(Schema.NonEmptyArray(NodeImage))(
  JSON.parse(
    readFileSync(new URL("../../../../../spec/fixtures/node-images.json", import.meta.url), "utf8"),
  ),
);
const native = Schema.decodeUnknownSync(Schema.NonEmptyArray(NativeFixture))(
  JSON.parse(
    readFileSync(new URL("../../../../../spec/fixtures/native.json", import.meta.url), "utf8"),
  ),
);
export const serverTargets = images
  .filter((image) => image.fixture !== "node")
  .map((image) => {
    const target = native.find((fixture) => fixture.id === image.fixture);
    if (target === undefined || !image.image.endsWith(`:${target.version}`))
      throw new Error("Fixture image differs from pinned native target");
    return {
      fixture: image.fixture,
      image: image.image,
      digest: image.digest,
      modules: image.modules ?? {},
      version: target.version,
      product: target.product,
      reference: `${image.image}@${image.digest}`,
    };
  });
export type ServerTarget = (typeof serverTargets)[number];

export const allocateServer = Effect.fnUntraced(function* (
  target: ServerTarget,
  options?: {
    readonly tls?: Certificates;
    readonly extraConfig?: ReadonlyArray<string>;
    readonly readinessMillis?: number;
    readonly unixVolume?: string;
  },
) {
  const directory = yield* temporaryDirectory;
  const tls = options?.tls;
  if (tls !== undefined) {
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          ["ca.crt", "server.crt", "server.key"].map((name) =>
            copyFile(join(tls.directory, name), join(directory, name)),
          ),
        ),
      catch: (cause) => new FixtureError({ stage: "tls-copy", cause: Redacted.make(cause) }),
    });
  }
  // Redis sees the container network peer; the published host port is loopback-only.
  const configuration = [
    "bind 0.0.0.0",
    "protected-mode no",
    'save ""',
    "appendonly no",
    "daemonize no",
    "dir /data",
    ...(tls === undefined
      ? ["port 6379"]
      : [
          "port 0",
          "tls-port 6379",
          "tls-ca-cert-file /fixture/ca.crt",
          "tls-cert-file /fixture/server.crt",
          "tls-key-file /fixture/server.key",
          "tls-auth-clients yes",
        ]),
    ...(options?.unixVolume === undefined
      ? []
      : ["unixsocket /socket/redis.sock", "unixsocketperm 777"]),
    ...(options?.extraConfig ?? []),
    "",
  ].join("\n");
  yield* Effect.tryPromise({
    try: () => writeFile(join(directory, "server.conf"), configuration),
    catch: (cause) => new FixtureError({ stage: "server-config", cause: Redacted.make(cause) }),
  });
  const name = `effect-redis-${randomUUID()}`;
  const executable = target.product === "valkey" ? "valkey-server" : "redis-server";
  yield* Effect.acquireRelease(Effect.succeed(name), () =>
    command("docker", ["rm", "--force", name], true).pipe(Effect.orDie),
  );
  // Bypass image entrypoints that inject modules or switch users; configuration is ours.
  // Protect the bounded allocation request; cleanup already owns its unique name.
  yield* command("docker", [
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    "effect-redis.fixture=true",
    "--entrypoint",
    executable,
    "--user",
    "0:0",
    "--read-only",
    "--tmpfs",
    "/data:rw,noexec,nosuid,size=16m",
    "--publish",
    "127.0.0.1::6379",
    "--mount",
    `type=bind,src=${directory},dst=/fixture,readonly`,
    ...(options?.unixVolume === undefined
      ? []
      : ["--mount", `type=volume,src=${options.unixVolume},dst=/socket`]),
    target.reference,
    "/fixture/server.conf",
  ]).pipe(Effect.uninterruptible);
  const start = Effect.gen(function* () {
    yield* command("docker", ["start", name]).pipe(Effect.uninterruptible);
    const binding = yield* command("docker", ["port", name, "6379/tcp"]);
    const port = Number(binding.replace("127.0.0.1:", ""));
    yield* Schema.decodeUnknownEffect(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
    )(port).pipe(Effect.mapError(() => new FixtureError({ stage: "server-port" })));
    yield* probe(port, tls).pipe(
      Effect.retry({ schedule: Schedule.spaced(50), times: 60 }),
      Effect.timeoutOrElse({
        duration: options?.readinessMillis ?? 10_000,
        orElse: () => Effect.fail(new FixtureError({ stage: "server-readiness" })),
      }),
    );
    const build = yield* command("docker", ["exec", name, executable, "--version"]);
    if (!build.includes(`v=${target.version} `))
      return yield* new FixtureError({ stage: "server-version" });
    return {
      port,
      name,
      directory,
      target,
      build,
      configurationDigest: createHash("sha256").update(configuration).digest("hex"),
    };
  }).pipe(
    Effect.catch((error) =>
      command("docker", ["logs", "--tail", "20", name]).pipe(
        Effect.flatMap((diagnostic) =>
          Effect.fail(
            new FixtureError({
              stage: error.stage,
              diagnostic: diagnostic.slice(0, 2048),
              cause: Redacted.make(error),
            }),
          ),
        ),
      ),
    ),
  );
  return { name, directory, start };
});

export const dockerServer = Effect.fnUntraced(function* (target: ServerTarget, tls?: Certificates) {
  return yield* (yield* allocateServer(target, tls === undefined ? undefined : { tls })).start;
});
