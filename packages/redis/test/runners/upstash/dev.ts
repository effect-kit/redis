import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Cause, Effect, Exit, Redacted } from "effect";

import { selectRuntime } from "#test/support/runtime/Selection";
import { FixtureError } from "#test/support/servers/FixtureError";
import { serverTargets } from "#test/support/servers/Targets";
import { upstashFixture } from "#test/support/upstash/Fixture";
import { runHttpRuntime } from "#test/support/upstash/Process";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  options: {
    engine: { type: "string", default: "redis" },
    runtime: { type: "string", default: "node" },
  },
  strict: true,
});
const target = serverTargets.find(
  (server) => server.fixture === values.engine && ["redis", "valkey"].includes(server.fixture),
);
if (target === undefined)
  throw new Error("Use --engine redis|valkey for an owned HTTP development fixture");
const runtime = selectRuntime(values.runtime);
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const program = Effect.gen(function* () {
  const fixture = yield* upstashFixture(target);
  const prefix = `http-dev:${randomUUID()}`;
  const connection = {
    url: fixture.input.url,
    token: Redacted.value(fixture.input.token),
    prefix,
    pipelineResponseFormat: fixture.input.pipelineResponseFormat,
  };
  const directory = new URL("../../results/", import.meta.url);
  const path = new URL(`upstash-dev-${randomUUID()}.json`, directory);

  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(directory, { recursive: true });
        await writeFile(path, JSON.stringify(connection), { mode: 0o600, flag: "wx" });
        return path;
      },
      catch: () => new FixtureError({ stage: "http-development-connection" }),
    }),
    (owned) => Effect.promise(() => rm(owned, { force: true })),
  );

  const runtimes: ReadonlyArray<"node" | "bun"> = runtime === "all" ? ["node", "bun"] : [runtime];
  for (const selected of runtimes)
    yield* runHttpRuntime(selected, { ...connection, prefix: `${prefix}:${selected}` });

  process.stdout.write(`Local HTTP fixture ready: ${fixture.input.url}\n`);
  process.stdout.write("SET/GET, binary, int64, Schema, batches, Streams and SSE checks passed.\n");
  process.stdout.write(`Connection file (private, ignored): ${fileURLToPath(path)}\n`);
  process.stdout.write("Press Ctrl+C to remove the fixture and connection file.\n");
  // Docker's reaper socket is unref'ed; a scoped live timer keeps the interactive process alive.
  yield* Effect.forever(Effect.sleep(60_000));
});

try {
  const exit = await Effect.runPromiseExit(Effect.scoped(program), { signal: controller.signal });
  if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) {
    const error = Cause.squash(exit.cause);
    process.stderr.write(
      `HTTP development fixture failed: ${error instanceof FixtureError ? error.stage : "runtime-check"}\n`,
    );
    process.exitCode = 1;
  }
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
