import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";

import { decodeSentinelConfig } from "#/sentinel/Config";
import { makeRedisSentinel } from "#/sentinel/RedisSentinel";
import { sent } from "#test/support/connection/Controlled";
import {
  addressReply,
  primaryRole,
  replicaRole,
  sentinelControlled,
  sentinelTransport,
} from "#test/support/sentinel/Controlled";

it.effect(
  "a stale Sentinel candidate is role-checked and the next Sentinel can supply the primary",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelTransport();
      const config = yield* decodeSentinelConfig({
        serviceName: "cache",
        sentinels: ["s1", "s2"].map((host) => ({ endpoint: { host }, protocol: "resp2" })),
        data: { protocol: "resp2" },
      });
      const opening = yield* Effect.forkChild(
        makeRedisSentinel(config, { discoveryAttempts: 1 }).pipe(Effect.provide(fixture.layer)),
      );
      const stale = yield* fixture.next;
      expect(stale.host).toBe("s1");
      yield* sent(
        stale.fixture,
        ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
        addressReply("a"),
      );
      const replica = yield* fixture.next;
      yield* sent(replica.fixture, ["ROLE"], replicaRole);
      const accepted = yield* fixture.discovery("b");
      expect(accepted.control.host).toBe("s2");

      const client = yield* Fiber.join(opening);
      expect((yield* client.topology).primary.host).toBe("b");
      expect((yield* replica.fixture.observations).closed).toBe(1);
    }),
);

it.effect("unknown service is a discovery failure and never opens a data socket", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelTransport();
    const config = yield* decodeSentinelConfig({
      serviceName: "cache",
      sentinels: [{ endpoint: { host: "s1" }, protocol: "resp2" }],
    });
    const opening = yield* Effect.forkChild(
      Effect.flip(
        makeRedisSentinel(config, { discoveryAttempts: 1 }).pipe(Effect.provide(fixture.layer)),
      ),
    );
    const control = yield* fixture.next;
    yield* sent(control.fixture, ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"], "*-1\r\n");

    expect(yield* Fiber.join(opening)).toMatchObject({
      reason: "unknown-service",
      plane: "sentinel",
    });
    expect(fixture.acquired()).toBe(1);
    expect((yield* control.fixture.observations).closed).toBe(1);
  }),
);

it.effect(
  "concurrent refresh shares discovery and cancellation of one waiter does not orphan peers",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled();
      const first = yield* Effect.forkChild(fixture.client.refresh);
      const control = yield* fixture.next;
      const second = yield* Effect.forkChild(fixture.client.refresh);
      const third = yield* Effect.forkChild(fixture.client.refresh);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      yield* sent(
        control.fixture,
        ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
        addressReply(),
      );
      const probe = yield* fixture.next;
      yield* sent(probe.fixture, ["ROLE"], primaryRole);

      expect(yield* Fiber.join(second)).toEqual(yield* Fiber.join(third));
      expect(fixture.acquired()).toBe(4);
      expect(yield* fixture.client.snapshot).toMatchObject({ revision: 1, refreshWaiters: 0 });
    }),
);

it.effect("refresh waiters are bounded before more endpoint work starts", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled({ maxOperations: 1 });
    const first = yield* Effect.forkChild(fixture.client.refresh);
    const control = yield* fixture.next;

    expect(yield* Effect.flip(fixture.client.refresh)).toMatchObject({
      reason: "capacity",
      plane: "sentinel",
    });
    yield* sent(control.fixture, ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"], addressReply());
    const probe = yield* fixture.next;
    yield* sent(probe.fixture, ["ROLE"], primaryRole);
    yield* Fiber.join(first);

    expect(fixture.acquired()).toBe(4);
  }),
);

it.effect("closing during discovery completes waiters and prevents later acquisition", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled();
    const waiting = yield* Effect.forkChild(Effect.exit(fixture.client.refresh));
    const control = yield* fixture.next;
    yield* fixture.client.close;

    const result = yield* Fiber.join(waiting);
    expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
    expect((yield* control.fixture.observations).closed).toBe(1);
    expect(yield* Effect.flip(fixture.client.redis.get("key"))).toMatchObject({ reason: "closed" });
  }),
);
