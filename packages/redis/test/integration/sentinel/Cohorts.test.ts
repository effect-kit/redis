import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Scope } from "effect";

import { sentinelControlled } from "#test/support/sentinel/Controlled";

it.effect("ownership changes clear lazy cache cohorts and unlink caller finalizers", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const caller = yield* Scope.fork(yield* Effect.scope);
    const tracking = yield* fixture.client.tracking().pipe(Scope.provide(caller));
    const cache = yield* tracking.cache().pipe(Scope.provide(caller));
    const refresh = yield* Effect.forkChild(fixture.client.refresh);
    yield* fixture.discovery("b");
    yield* Fiber.join(refresh);

    expect(yield* cache.snapshot).toMatchObject({ active: false, entries: 0 });
    expect(yield* Effect.flip(cache.getBytes("key"))).toMatchObject({ reason: "topology-changed" });
    expect(caller.state._tag).toBe("Empty");
    expect(yield* fixture.client.snapshot).toMatchObject({ eventCohorts: 0 });
  }),
);

it.effect(
  "event capacity rejection releases its child Scope and manual close retires retained views",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled({ maxEventCohorts: 1 });
      const caller = yield* Scope.fork(yield* Effect.scope);
      yield* fixture.client.tracking().pipe(Scope.provide(caller));

      expect(yield* Effect.flip(fixture.client.pubsub().pipe(Scope.provide(caller)))).toMatchObject(
        { reason: "capacity" },
      );
      expect(yield* fixture.client.snapshot).toMatchObject({ eventCohorts: 1 });
      yield* fixture.client.close;

      expect(caller.state._tag).toBe("Empty");
      expect(yield* fixture.client.snapshot).toMatchObject({ closed: true, eventCohorts: 0 });
    }),
);
