import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { sent } from "#test/support/connection/Controlled";
import { sentinelControlled } from "#test/support/sentinel/Controlled";

it.effect("intentional session retirement preserves healthy topology and cache cohorts", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    yield* fixture.client.tracking();
    const operation = yield* Effect.forkChild(
      fixture.client.withSession((session) => session.selectDatabase(0)),
    );
    const physical = yield* fixture.data();
    yield* sent(physical.fixture, ["SELECT", "0"], "+OK\r\n");
    yield* Fiber.join(operation);

    expect(yield* fixture.client.snapshot).toMatchObject({
      obsolete: false,
      revision: 1,
      eventCohorts: 1,
    });
    expect((yield* physical.fixture.observations).closed).toBe(1);
  }),
);

it.effect("pool pressure cannot invalidate a healthy generation or its event cohorts", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled({
      maxOperations: 4,
      sessions: { maxSessionConnections: 1, maxWaiters: 1 },
    });
    yield* fixture.client.tracking();
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      fixture.client.withSession(() =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ),
    );
    yield* fixture.data();
    yield* Deferred.await(entered);
    const second = yield* Effect.forkChild(fixture.client.withSession(() => Effect.void));
    yield* Effect.yieldNow;

    expect(yield* Effect.flip(fixture.client.withSession(() => Effect.void))).toMatchObject({
      _tag: "SessionError",
      reason: "pool-full",
    });
    expect(yield* fixture.client.snapshot).toMatchObject({
      obsolete: false,
      revision: 1,
      eventCohorts: 1,
    });

    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(fixture.acquired()).toBe(5);
  }),
);
