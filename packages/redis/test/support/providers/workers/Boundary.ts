import { Effect, Schedule } from "effect";

import { deploymentHeader } from "#test/runners/providers/WorkerResponse";
import { ProviderTestError } from "#test/support/providers/Failures";

export const checkWorkerBoundary = (
  deployment: string,
  probe: { readonly id: string; readonly expected: number },
  response: Response,
) => {
  if (response.headers.get(deploymentHeader) !== deployment)
    return Effect.fail(
      new ProviderTestError({
        stage: "worker-propagation",
        reason: "Probe reached a different deployment",
      }),
    );
  if (response.status !== probe.expected)
    return Effect.fail(
      new ProviderTestError({
        stage: `worker-access-${probe.id}-${response.status}`,
        reason: "Current Worker failed its access boundary",
      }),
    );
  return Effect.void;
};

/** Retry only deployment convergence probes; a current-version access failure is immediately fatal. */
export const waitForWorkerBoundary = <R>(probe: Effect.Effect<void, ProviderTestError, R>) =>
  probe.pipe(
    Effect.retry({
      while: (error) => error.stage === "worker-propagation",
      schedule: Schedule.spaced(200),
    }),
    Effect.timeoutOrElse({
      duration: 15_000,
      orElse: () =>
        Effect.fail(
          new ProviderTestError({
            stage: "worker-propagation-timeout",
            reason: "Worker deployment did not converge",
          }),
        ),
    }),
  );
