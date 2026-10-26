import { Effect } from "effect";

import type { Observation } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";
import { safeFailure } from "#test/support/providers/Failures";

export function ensure(condition: unknown, id: string): asserts condition {
  if (!condition)
    throw new ProviderTestError({ stage: id, reason: "Unexpected provider behavior" });
}

export const utf8 = (value: string) => new TextEncoder().encode(value);
export const sameBytes = (left: Uint8Array | undefined, right: Uint8Array) =>
  left !== undefined &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/** Fixed scenarios have a command budget; assertion failures never print replies or secrets. */
export const assertions = (maximum = 160) => {
  const observations: Observation[] = [];
  let commands = 0;

  const record = (id: string, outcome: Observation["outcome"] = "passed", detail?: string) => {
    ensure(!observations.some((entry) => entry.id === id), "duplicate-observation");
    observations.push({ id, outcome, ...(detail === undefined ? {} : { detail }) });
  };

  const check = Effect.fnUntraced(function* <A, E, R>(
    id: string,
    operation: Effect.Effect<A, E, R>,
    verify: (value: A) => void,
    cost = 1,
  ) {
    commands += cost;
    ensure(commands <= maximum, "command-budget");
    const value = yield* operation.pipe(
      Effect.mapError(
        (error) =>
          new ProviderTestError({
            stage: `${id}:${safeFailure(error).reason ?? safeFailure(error)._tag ?? "failure"}`,
            reason: "Provider scenario failed",
          }),
      ),
    );
    verify(value);
    record(id);
    return value;
  });

  return { observations, check, record };
};
