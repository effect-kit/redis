import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";

/** Actual runtime children have bounded output, a hard deadline and joined cancellation. */
export const runRuntimeProgram = (options: {
  readonly runtime: "node" | "bun";
  readonly program: URL;
  readonly input: string;
  readonly timeout: number;
  readonly stage: string;
  readonly exposeGc?: boolean;
  readonly transformTypes?: boolean;
}) =>
  Effect.callback<string, FixtureError>((resume) => {
    const child = execFile(
      options.runtime === "node" ? process.execPath : "bun",
      [
        ...(options.runtime === "bun" ? ["--no-env-file", "--no-install"] : []),
        ...(options.runtime === "node" && options.exposeGc ? ["--expose-gc"] : []),
        ...(options.runtime === "node" && options.transformTypes
          ? ["--experimental-transform-types"]
          : []),
        fileURLToPath(options.program),
      ],
      { timeout: options.timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 },
      (cause, stdout, stderr) => {
        resume(
          cause === null
            ? Effect.succeed(stdout)
            : Effect.fail(
                new FixtureError({
                  stage: options.stage,
                  diagnostic: stderr.slice(0, 2048),
                  cause: Redacted.make(cause),
                }),
              ),
        );
      },
    );

    child.stdin?.on("error", () => {
      // A rejected scenario may exit before reading stdin; its exit status owns the failure.
    });
    child.stdin?.end(options.input);

    return Effect.callback<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done(Effect.void);
        return;
      }
      child.once("close", () => done(Effect.void));
      child.kill("SIGKILL");
    });
  });
