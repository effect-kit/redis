import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted, Schedule } from "effect";

import { command } from "#test/support/servers/Command";
import { FixtureError } from "#test/support/servers/FixtureError";
import { probe } from "#test/support/servers/Readiness";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";

/** Explicitly supplied Redis/Valkey executable; never discovers or installs a global binary. */
export const localServer = Effect.fnUntraced(function* (
  binary: string,
  engine: "redis" | "valkey",
) {
  const build = yield* command(binary, ["--version"]);
  if (!build.toLowerCase().startsWith(`${engine} server`) || !/v=\d+\.\d+\.\d+/.test(build))
    return yield* new FixtureError({ stage: "local-binary-version" });

  const directory = yield* temporaryDirectory;
  const path = join(directory, "redis.sock");
  const config = join(directory, "server.conf");

  yield* Effect.tryPromise({
    try: () =>
      writeFile(
        config,
        [
          "port 0",
          `unixsocket ${JSON.stringify(path)}`,
          "unixsocketperm 700",
          'save ""',
          "appendonly no",
          "daemonize no",
          `dir ${JSON.stringify(directory)}`,
          "",
        ].join("\n"),
        { mode: 0o600 },
      ),
    catch: (cause) => new FixtureError({ stage: "local-config", cause: Redacted.make(cause) }),
  });

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const process = spawn(binary, [config], { stdio: ["ignore", "pipe", "pipe"] });
        let diagnostic = "";
        let spawnError: Error | undefined;

        const record = (chunk: Buffer) => {
          diagnostic = (diagnostic + chunk.toString()).slice(-2048);
        };

        process.stdout.on("data", record);
        process.stderr.on("data", record);
        process.on("error", (error) => {
          spawnError = error;
        });

        const closed = new Promise<void>((resolve) => process.once("close", () => resolve()));

        return { process, closed, diagnostic: () => diagnostic, spawnError: () => spawnError };
      },
      catch: (cause) => new FixtureError({ stage: "local-spawn", cause: Redacted.make(cause) }),
    }),
    (acquired) =>
      Effect.promise(async () => {
        if (acquired.process.exitCode === null && acquired.process.signalCode === null)
          acquired.process.kill("SIGTERM");

        const timeout = setTimeout(() => acquired.process.kill("SIGKILL"), 2000);

        try {
          await acquired.closed;
        } finally {
          clearTimeout(timeout);
        }
      }),
  );

  yield* probe(path).pipe(
    Effect.retry({ schedule: Schedule.spaced(50), times: 60 }),
    Effect.mapError(
      (error) =>
        new FixtureError({
          stage: "local-readiness",
          diagnostic: child.diagnostic(),
          cause: Redacted.make(child.spawnError() ?? error),
        }),
    ),
  );

  return { path, directory, pid: child.process.pid, build };
});
