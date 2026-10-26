import { Cause, Effect } from "effect";

import { prepareDeno } from "#test/support/providers/Deno";
import { safeFailure } from "#test/support/providers/Failures";

const exit = await Effect.runPromiseExit(Effect.scoped(prepareDeno()));
if (exit._tag === "Failure") {
  process.stderr.write(`${JSON.stringify(safeFailure(Cause.squash(exit.cause)))}\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    `Prepared checksum-verified Deno ${exit.value.version} (${exit.value.target})\n`,
  );
