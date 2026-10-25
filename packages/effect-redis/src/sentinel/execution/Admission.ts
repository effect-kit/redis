import { Effect } from "effect";

import { ConnectionError } from "#/errors/ConnectionError";
import { SentinelError } from "#/errors/SentinelError";

/** Native wire budgets still own bytes; this bound includes callers waiting for discovery/pool admission. */
export const makeSentinelAdmission = (maximum: number, timeout: number) => {
  let active = 0;

  const run = <A, E, R>(
    body: (writing: () => void) => Effect.Effect<A, E, R>,
    deadline: number | "forever" = timeout,
  ) =>
    Effect.acquireUseRelease(
      Effect.suspend(() => {
        if (active >= maximum)
          return Effect.fail(
            new SentinelError({ reason: "capacity", plane: "data", delivery: "unsent" }),
          );
        active++;
        return Effect.void;
      }),
      () => {
        let written = false;
        const operation = Effect.suspend(() =>
          body(() => {
            written = true;
          }),
        );
        return deadline === "forever"
          ? operation
          : operation.pipe(
              Effect.timeoutOrElse({
                duration: deadline,
                orElse: () =>
                  Effect.fail(
                    new ConnectionError({
                      reason: "timeout",
                      delivery: written ? "possibly-written" : "unsent",
                      generation: 0,
                    }),
                  ),
              }),
            );
      },
      () =>
        Effect.sync(() => {
          active--;
        }),
    );

  return { run, snapshot: () => ({ activeOperations: active }) };
};
