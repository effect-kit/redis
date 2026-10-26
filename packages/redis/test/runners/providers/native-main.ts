import { Cause, Effect } from "effect";

import { runNative } from "#test/runners/providers/Native";
import { readInput, runtime, writeOutput } from "#test/runners/providers/Stdin";
import { NativeInput } from "#test/support/providers/Contract";
import { safeFailure } from "#test/support/providers/Failures";

try {
  const input = await readInput(NativeInput);
  const host = runtime();
  const layer =
    host.name === "bun"
      ? (await import("@effect-kit/redis/bun")).RedisBun.layer
      : (await import("@effect-kit/redis/node")).RedisNode.layer;
  const exit = await Effect.runPromiseExit(runNative(input, layer, host.name, host.version));
  if (exit._tag === "Failure")
    await writeOutput(`${JSON.stringify(safeFailure(Cause.squash(exit.cause)))}\n`, true);
  else await writeOutput(JSON.stringify(exit.value));
} catch (error) {
  await writeOutput(`${JSON.stringify(safeFailure(error))}\n`, true);
}
