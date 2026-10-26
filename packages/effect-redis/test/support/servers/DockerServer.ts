import { createHash } from "node:crypto";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted, Schedule } from "effect";

import { Wait } from "testcontainers";
import type { StartedNetwork } from "testcontainers";

import {
  containerRequest,
  FixtureContainer,
  scopedContainer,
} from "#test/support/servers/Containers";
import { FixtureError } from "#test/support/servers/FixtureError";
import { serverProfile } from "#test/support/servers/Profiles";
import { probe } from "#test/support/servers/Readiness";
import { serverTargets } from "#test/support/servers/Targets";
import type { ServerTarget } from "#test/support/servers/Targets";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";
import type { Certificates } from "#test/support/tls/Certificates";

export { serverTargets };
export type { ServerTarget };

export const allocateServer = Effect.fnUntraced(function* (
  target: ServerTarget,
  options?: {
    readonly tls?: Certificates;
    readonly password?: Redacted.Redacted<string>;
    readonly extraConfig?: ReadonlyArray<string>;
    readonly readinessMillis?: number;
    readonly unixVolume?: string;
    readonly network?: StartedNetwork;
    readonly networkAlias?: string;
    readonly writableConfiguration?: boolean;
    readonly aclRules?: string;
    readonly sentinel?: boolean;
  },
) {
  const directory = yield* temporaryDirectory;
  const tls = options?.tls;

  if (tls !== undefined) {
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          ["ca.crt", "server.crt", "server.key", "client.crt", "client.key"].map((name) =>
            copyFile(join(tls.directory, name), join(directory, name)),
          ),
        ),
      catch: (cause) => new FixtureError({ stage: "tls-copy", cause: Redacted.make(cause) }),
    });
  }

  // Redis sees the container network peer; the published host port is loopback-only.
  const profile = serverProfile(target);
  if (
    profile.configuration !== undefined &&
    (tls !== undefined ||
      options?.unixVolume !== undefined ||
      options?.extraConfig !== undefined ||
      options?.writableConfiguration !== undefined ||
      options?.aclRules !== undefined ||
      options?.password !== undefined)
  )
    return yield* new FixtureError({ stage: "unsupported-fixture-mode" });

  const configuration =
    profile.configuration ??
    [
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
      ...(options?.password === undefined
        ? []
        : [`requirepass ${JSON.stringify(Redacted.value(options.password))}`]),
      ...(options?.extraConfig ?? []),
      ...(options?.aclRules === undefined ? [] : ["aclfile /fixture/users.acl"]),
      "",
    ].join("\n");

  yield* Effect.tryPromise({
    try: () => writeFile(join(directory, "server.conf"), configuration),
    catch: (cause) => new FixtureError({ stage: "server-config", cause: Redacted.make(cause) }),
  });
  if (options?.aclRules !== undefined)
    yield* Effect.tryPromise({
      try: () => writeFile(join(directory, "users.acl"), options.aclRules ?? ""),
      catch: (cause) => new FixtureError({ stage: "acl-file", cause: Redacted.make(cause) }),
    });

  const container = new FixtureContainer(target.reference)
    .withEntrypoint([profile.executable])
    .withCommand(options?.sentinel ? [...profile.command, "--sentinel"] : profile.command)
    .withTmpFs({ "/data": "rw,nosuid,size=256m", "/tmp": "rw,noexec,nosuid,size=16m" })
    .withBindMounts([
      { source: directory, target: "/fixture", mode: options?.writableConfiguration ? "rw" : "ro" },
    ])
    .loopbackPort(profile.port)
    // No in-container shell assumptions (Redict is scratch); the independent PING probe owns readiness.
    .withWaitStrategy(Wait.forAll([]))
    .withStartupTimeout(15_000);
  if (options?.unixVolume !== undefined) container.sharedVolume(options.unixVolume, "/socket");

  if (options?.network !== undefined) {
    container.withNetwork(options.network);
    if (options.networkAlias !== undefined) container.withNetworkAliases(options.networkAlias);
  }

  const started = yield* scopedContainer(container);
  const name = container.fixtureName;
  const port = started.getMappedPort(profile.port);

  const start = Effect.gen(function* () {
    yield* probe(port, tls, options?.password).pipe(
      Effect.retry({ schedule: Schedule.spaced(50), times: 60 }),
      Effect.timeoutOrElse({
        duration: options?.readinessMillis ?? 10_000,
        orElse: () => Effect.fail(new FixtureError({ stage: "server-readiness" })),
      }),
    );

    const version = yield* containerRequest("server-version", () => started.exec(profile.version));
    const build = version.output.trim();
    if (version.exitCode !== 0 || !build.includes(target.version))
      return yield* new FixtureError({ stage: "server-version", diagnostic: build.slice(0, 512) });

    return {
      port,
      name,
      directory,
      target,
      build,
      configurationDigest: createHash("sha256")
        .update(
          JSON.stringify({
            configuration,
            writableConfiguration: options?.writableConfiguration ?? false,
            aclRules: options?.aclRules,
            executable: profile.executable,
            command: options?.sentinel ? [...profile.command, "--sentinel"] : profile.command,
          }),
        )
        .digest("hex"),
      ...(options?.network === undefined
        ? {}
        : { networkAddress: started.getIpAddress(options.network.getName()) }),
    };
  });

  return {
    name,
    directory,
    start: start.pipe(
      Effect.mapError(
        (error) =>
          new FixtureError({
            stage: error.stage,
            diagnostic: error.diagnostic ?? container.diagnostic,
            cause: Redacted.make(error),
          }),
      ),
    ),
  };
});

export const dockerServer = Effect.fnUntraced(function* (target: ServerTarget, tls?: Certificates) {
  return yield* (yield* allocateServer(target, tls === undefined ? undefined : { tls })).start;
});
