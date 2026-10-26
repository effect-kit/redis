import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";
import { httpTargets } from "#test/support/upstash/Fixture";

it.live.each(httpTargets)(
  "HTTP-DEV: $fixture interactive fixture owns credentials and cleanup",
  (target) =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const child = spawn(
            process.execPath,
            [
              "--experimental-transform-types",
              fileURLToPath(new URL("../../runners/upstash/dev.ts", import.meta.url)),
              "--engine",
              target.fixture,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "";
          const closed = new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
          });
          const ready = new Promise<string>((resolve, reject) => {
            child.stdout.on("data", (chunk: Buffer) => {
              output += chunk.toString("utf8");
              if (output.length > 64 * 1024) {
                reject(new Error("Development output exceeded its budget"));
                return;
              }
              const match = /Connection file \(private, ignored\): (.+)\n/.exec(output);
              if (match?.[1] !== undefined) resolve(match[1]);
            });
            void closed.then(
              () => reject(new Error("Development fixture exited before readiness")),
              reject,
            );
          });
          // Consume stderr without retaining diagnostics that could contain local connection state.
          child.stderr.resume();
          return { child, closed, ready };
        }),
        ({ child, closed }) =>
          Effect.promise(async () => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
            const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
            try {
              await closed;
            } finally {
              clearTimeout(deadline);
            }
          }),
      );
      const path = yield* Effect.tryPromise({
        try: () => fixture.ready,
        catch: () => new FixtureError({ stage: "http-development-ready" }),
      }).pipe(Effect.timeout(30_000));

      yield* Effect.promise(async () => {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        const connection: { url: string; token: string } = JSON.parse(await readFile(path, "utf8"));
        const response = await fetch(connection.url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(["PING"]),
          signal: AbortSignal.timeout(5000),
        });
        expect(response.ok).toBe(true);
        expect(await response.json()).toEqual({ result: "PONG" });

        fixture.child.kill("SIGTERM");
        expect(await fixture.closed).toBe(0);
        await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          fetch(`${connection.url}/health`, { signal: AbortSignal.timeout(2000) }),
        ).rejects.toBeDefined();
      });
    }),
);
