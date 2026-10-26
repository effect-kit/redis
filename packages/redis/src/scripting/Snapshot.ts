import { Effect } from "effect";

import type { ScriptArguments } from "#/commands/scripting/Invocation";
import { CommandInputError } from "#/errors/CommandInputError";

/** Recovery retains binary intent, but must measure its additional ownership before copying. */
export const snapshotArguments = Effect.fnUntraced(function* (
  input: ScriptArguments,
  maximum: number,
) {
  let remaining = maximum;

  for (const argumentList of [input.keys, input.args ?? []]) {
    for (const argument of argumentList) {
      if (typeof argument === "string") continue;
      if (argument.byteLength > remaining)
        return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });

      remaining -= argument.byteLength;
    }
  }

  // Strings are immutable. Only binary payloads need a second owner across recovery attempts.
  return {
    keys: input.keys.map((key) => (typeof key === "string" ? key : new Uint8Array(key))),
    args: (input.args ?? []).map((arg) => (typeof arg === "string" ? arg : new Uint8Array(arg))),
  };
});
