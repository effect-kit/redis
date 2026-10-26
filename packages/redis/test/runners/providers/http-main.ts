import { Cause, Effect } from "effect";

import { runHttp } from "#test/runners/providers/Http";
import { readInput, runtime, writeOutput } from "#test/runners/providers/Stdin";
import { HttpInput } from "#test/support/providers/Contract";
import { safeFailure } from "#test/support/providers/Failures";

try {
  const input = await readInput(HttpInput);
  const host = runtime();
  const exit = await Effect.runPromiseExit(runHttp(input, host.name, host.version));
  if (exit._tag === "Failure")
    await writeOutput(`${JSON.stringify(safeFailure(Cause.squash(exit.cause)))}\n`, true);
  else await writeOutput(JSON.stringify(exit.value));
} catch (error) {
  await writeOutput(`${JSON.stringify(safeFailure(error))}\n`, true);
}
