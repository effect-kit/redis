import { execFile } from "node:child_process";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";

export const command = (file: string, args: ReadonlyArray<string>) =>
  Effect.callback<string, FixtureError>((resume) => {
    const child = execFile(
      file,
      [...args],
      { timeout: 30_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resume(
            Effect.fail(
              new FixtureError({
                stage: "fixture-command",
                diagnostic: stderr.slice(0, 2048),
                cause: Redacted.make(error),
              }),
            ),
          );
        } else resume(Effect.succeed(stdout.trim()));
      },
    );
    return Effect.callback<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done(Effect.void);
        return;
      }
      child.once("close", () => done(Effect.void));
      child.kill("SIGKILL");
    });
  });
