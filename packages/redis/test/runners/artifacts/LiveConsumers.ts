import { cp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Redacted, Schema } from "effect";

import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { bunRuntimeImage, serverTargets } from "#test/support/servers/Targets";
import { upstashFixture } from "#test/support/upstash/Fixture";

const Receipt = Schema.Struct({
  runtime: Schema.Literals(["node", "bun"]),
  version: Schema.NonEmptyString,
  checks: Schema.Array(Schema.NonEmptyString),
});

export const checkLiveConsumers = async (consumer: string, fixture: string) => {
  await cp(join(fixture, "live.mjs"), join(consumer, "live.mjs"));

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observations = [];

        for (const engine of ["redis", "valkey"]) {
          const target = serverTargets.find((entry) => entry.fixture === engine);

          if (target === undefined) return yield* Effect.die("Missing release fixture");

          // Scope each backend independently; no server state survives into the next cell.
          const receipts = yield* Effect.scoped(
            Effect.gen(function* () {
              const backend = yield* upstashFixture(target);
              const endpoint = backend.nativeConfig.endpoint;

              if (endpoint._tag !== "Tcp")
                return yield* Effect.die("Release fixture requires a loopback TCP endpoint");

              const output = [];

              for (const runtime of ["node", "bun"] as const) {
                const receipt = yield* runRuntimeProgram({
                  runtime,
                  program: pathToFileURL(join(consumer, "live.mjs")),
                  input: JSON.stringify({
                    runtime,
                    endpoint: { host: endpoint.host, port: endpoint.port },
                    http: {
                      ...backend.input,
                      token: Redacted.value(backend.input.token),
                    },
                  }),
                  timeout: 60_000,
                  stage: "packed-release-consumer",
                });
                const decoded = Schema.decodeUnknownSync(Receipt)(JSON.parse(receipt));

                const expectedChecks = ["native", "http"].flatMap((transport) =>
                  ["text", "bytes-int64", "schema", "batches"].map(
                    (check) => `${transport}:${check}`,
                  ),
                );

                if (
                  decoded.runtime !== runtime ||
                  decoded.version !==
                    (runtime === "node" ? process.versions.node : bunRuntimeImage.version) ||
                  decoded.checks.length !== expectedChecks.length ||
                  expectedChecks.some((check) => !decoded.checks.includes(check))
                )
                  return yield* Effect.die("Incomplete packed consumer evidence");

                output.push(decoded);
              }

              return {
                engine,
                build: backend.build,
                configurationDigest: backend.configurationDigest,
                receipts: output,
              };
            }),
          );

          observations.push(receipts);
        }

        return observations;
      }),
    ),
  );
};
