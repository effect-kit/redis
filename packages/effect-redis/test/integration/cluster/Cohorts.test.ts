import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Scope } from "effect";

import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { sent } from "#test/support/connection/Controlled";

it.effect(
  "retired tracking cohorts unlink caller finalizers across repeated ownership changes",
  () =>
    Effect.gen(function* () {
      const { client, seed } = yield* clusterControlled();
      const caller = yield* Scope.fork(yield* Effect.scope);
      const retained = [];
      for (let iteration = 0; iteration < 6; iteration++) {
        retained.push(yield* client.tracking({ key: "foo" }).pipe(Scope.provide(caller)));
        const refresh = yield* Effect.forkChild(client.refresh);
        const target = iteration % 2 === 0 ? "b" : "a";
        yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply(target, `node-${target}`));
        yield* Fiber.join(refresh);

        expect(caller.state._tag).toBe("Empty");
        expect(yield* client.snapshot).toMatchObject({ eventCohorts: 0 });
      }
      expect(
        yield* Effect.flip(retained[0]?.getBytes("foo") ?? Effect.die("Missing cohort")),
      ).toMatchObject({ reason: "topology-changed" });
    }),
);

it.effect("manual Cluster close releases cohorts owned by a longer-lived caller", () =>
  Effect.gen(function* () {
    const { client } = yield* clusterControlled();
    const caller = yield* Scope.fork(yield* Effect.scope);
    const tracking = yield* client.tracking({ key: "foo" }).pipe(Scope.provide(caller));
    const cache = yield* tracking.cache().pipe(Scope.provide(caller));
    yield* client.close;

    expect(yield* client.snapshot).toMatchObject({ closed: true, eventCohorts: 0 });
    expect(yield* cache.snapshot).toMatchObject({ active: false, entries: 0 });
    expect(caller.state._tag).toBe("Empty");
    yield* Scope.close(caller, Exit.void);
  }),
);

it.effect("observer admission failure releases the unacquired event cohort", () =>
  Effect.gen(function* () {
    const { client } = yield* clusterControlled({ maxOperations: 1 });
    yield* client.tracking({ key: "foo" });

    const rejected = yield* Effect.flip(client.tracking({ key: "foo" }));

    expect(rejected).toMatchObject({ reason: "capacity" });
    expect(yield* client.snapshot).toMatchObject({ eventCohorts: 1 });

    yield* client.close;

    expect(yield* client.snapshot).toMatchObject({ eventCohorts: 0 });
  }),
);
