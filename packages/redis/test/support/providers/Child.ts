import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { packageRoot } from "#test/support/providers/Configuration";
import { requireDeno } from "#test/support/providers/Deno";
import { ProviderTestError } from "#test/support/providers/Failures";

export const runProviderProgram = Effect.fnUntraced(function* (
  runtime: "node" | "bun" | "deno",
  program: URL,
  input: { readonly url: string },
) {
  const deno = runtime === "deno" ? yield* requireDeno() : undefined;
  const executable = deno?.binary ?? (runtime === "bun" ? "bun" : process.execPath);
  const args =
    runtime === "deno"
      ? [
          "run",
          "--no-config",
          "--no-lock",
          "--no-npm",
          "--no-remote",
          `--allow-net=${new URL(input.url).host}`,
          fileURLToPath(program),
        ]
      : [...(runtime === "bun" ? ["--no-env-file", "--no-install"] : []), fileURLToPath(program)];
  const env = Object.fromEntries(
    ["PATH", "LANG", "TMPDIR", "SystemRoot", "SYSTEMROOT"].flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

  return yield* Effect.callback<string, ProviderTestError>((resume) => {
    const child = execFile(
      executable,
      args,
      {
        cwd: packageRoot,
        env,
        timeout: 90_000,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
      },
      (error, stdout, stderr) => {
        if (error === null) resume(Effect.succeed(stdout));
        else {
          // Child programs emit only safe enum fields; never forward arbitrary stderr into test reports.
          let stage = "runtime";
          try {
            const diagnostic: unknown = JSON.parse(stderr.trim());
            if (
              typeof diagnostic === "object" &&
              diagnostic !== null &&
              "stage" in diagnostic &&
              typeof diagnostic.stage === "string" &&
              /^[A-Za-z0-9_.:-]{1,64}$/.test(diagnostic.stage)
            )
              stage = diagnostic.stage;
          } catch {
            /* A launcher/runtime failure has no trusted diagnostic envelope. */
          }
          resume(
            Effect.fail(
              new ProviderTestError({ stage, reason: `Failed ${runtime} provider scenario` }),
            ),
          );
        }
      },
    );
    child.stdin?.on("error", () => {
      /* Child exit owns input-pipe failure. */
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
});
