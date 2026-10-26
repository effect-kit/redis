import { Effect } from "effect";

import { Wait } from "testcontainers";

import { FixtureContainer, scopedContainer } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import { awaitReadiness, probe } from "#test/support/servers/Readiness";
import type { ReadinessObservation } from "#test/support/servers/Readiness";
import type { ServerTarget } from "#test/support/servers/Targets";

/** Publish the port four seconds before Redis starts, reproducing Docker forwarding during startup. */
export const delayedReadiness = Effect.fnUntraced(function* (target: ServerTarget) {
  const observations: ReadinessObservation[] = [];
  const container = new FixtureContainer(target.reference)
    .withEntrypoint(["/bin/sh"])
    .withCommand([
      "-c",
      "sleep 4; exec redis-server --bind 0.0.0.0 --protected-mode no --save '' --appendonly no",
    ])
    .withTmpFs({ "/data": "rw,nosuid,size=32m", "/tmp": "rw,noexec,nosuid,size=16m" })
    .loopbackPort(6379)
    .withWaitStrategy(Wait.forAll([]));
  const started = yield* scopedContainer(container);
  const began = performance.now();
  yield* awaitReadiness(
    probe(started.getMappedPort(6379), undefined, undefined, (observation) =>
      observations.push(observation),
    ),
  );
  if (
    observations.length < 2 ||
    !observations.some((observation) => observation.outcome !== "ready")
  )
    return yield* Effect.die(new Error("Delayed fixture did not exercise startup failures"));
  return {
    delayed: true,
    engine: target.product,
    elapsedMillis: performance.now() - began,
    observations,
  };
});

export const readinessChurn = Effect.fnUntraced(function* (target: ServerTarget, count: number) {
  const receipts = [];
  for (let cycle = 0; cycle < count; cycle++) {
    const observations: ReadinessObservation[] = [];
    const began = performance.now();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* allocateServer(target, {
          onReadiness: (observation) => observations.push(observation),
        });
        yield* server.start;
      }),
    );
    receipts.push({ cycle, elapsedMillis: performance.now() - began, observations });
  }
  return { engine: target.product, receipts };
});
