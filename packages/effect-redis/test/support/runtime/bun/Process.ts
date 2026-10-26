import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Effect, Redacted, Schema } from "effect";

import type { RuntimeInput } from "#test/support/runtime/bun/Input";
import { FixtureError } from "#test/support/servers/FixtureError";
import { bunRuntimeImage, bunRuntimeRevision } from "#test/support/servers/Targets";

const Receipt = Schema.Struct({
  bun: Schema.Literal(bunRuntimeImage.version),
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  scenario: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(Schema.NonEmptyString),
});

export const readBunReceipt = Effect.fnUntraced(function* (output: string, scenario: string) {
  const receipt = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Receipt)(JSON.parse(output)),
    catch: (cause) =>
      new FixtureError({ stage: "bun-runtime-receipt", cause: Redacted.make(cause) }),
  });

  if (receipt.scenario !== scenario)
    return yield* new FixtureError({ stage: "bun-runtime-scenario" });
  if (receipt.revision !== bunRuntimeRevision)
    return yield* new FixtureError({ stage: "bun-runtime-revision" });

  return receipt;
});

/** One actual Bun process per scenario, with bounded output and awaited cancellation. */
export const runBun = Effect.fnUntraced(function* (input: RuntimeInput, timeout = 30_000) {
  const output = yield* Effect.callback<string, FixtureError>((resume) => {
    const child = execFile(
      "bun",
      [
        "--no-env-file",
        "--no-install",
        fileURLToPath(new URL("../../../runners/bun/main.ts", import.meta.url)),
      ],
      { timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 },
      (cause, stdout, stderr) => {
        resume(
          cause === null
            ? Effect.succeed(stdout)
            : Effect.fail(
                new FixtureError({
                  stage: "bun-runtime",
                  diagnostic: stderr.slice(0, 2048),
                  cause: Redacted.make(cause),
                }),
              ),
        );
      },
    );
    child.stdin?.on("error", () => {
      // A rejected scenario can exit before consuming all input; exit status owns the failure.
    });
    child.stdin?.end(JSON.stringify(input));

    return Effect.callback<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done(Effect.void);
        return;
      }

      child.once("close", () => done(Effect.void));
      child.kill("SIGKILL");
    });
  });

  return yield* readBunReceipt(output, input.scenario);
});
