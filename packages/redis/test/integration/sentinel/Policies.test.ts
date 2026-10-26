import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { Commands } from "#/index";
import { decodeSentinelConfig } from "#/sentinel/Config";
import { makeRedisSentinel } from "#/sentinel/RedisSentinel";
import { sent } from "#test/support/connection/Controlled";
import { sentinelControlled, sentinelTransport } from "#test/support/sentinel/Controlled";

it.effect("candidate deadlines use Clock and close the pending physical exchange", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelTransport();
    const config = yield* decodeSentinelConfig({
      serviceName: "cache",
      sentinels: [{ endpoint: { host: "s1" }, protocol: "resp2" }],
    });
    const opening = yield* Effect.forkChild(
      Effect.flip(
        makeRedisSentinel(config, { discoveryAttempts: 1, sentinelTimeoutMillis: 10 }).pipe(
          Effect.provide(fixture.layer),
        ),
      ),
    );
    const control = yield* fixture.next;
    yield* sent(control.fixture, ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"]);
    yield* TestClock.adjust(11);

    expect(yield* Fiber.join(opening)).toMatchObject({ reason: "timeout", plane: "sentinel" });
    expect((yield* control.fixture.observations).closed).toBe(1);
  }),
);

it.effect("periodic rediscovery publishes the new owner and stops on close", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelControlled({ refreshIntervalMillis: 10 });
    yield* TestClock.adjust(10);
    yield* fixture.discovery("b");
    while ((yield* fixture.client.snapshot).revision !== 2) yield* Effect.yieldNow;

    expect((yield* fixture.client.topology).primary.host).toBe("b");
    yield* fixture.client.close;
    const count = fixture.acquired();
    yield* TestClock.adjust(1000);
    expect(fixture.acquired()).toBe(count);
  }),
);

it.effect(
  "operation admission bounds callers while discovery is pending and cancellation releases capacity",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled({ maxOperations: 1 });
      const waiting = yield* Effect.forkChild(fixture.client.redis.get("key"));
      yield* fixture.next;

      expect(yield* Effect.flip(fixture.client.redis.get("other"))).toMatchObject({
        reason: "capacity",
        plane: "data",
      });
      yield* Fiber.interrupt(waiting);
      expect(yield* fixture.client.snapshot).toMatchObject({ activeOperations: 0 });
      yield* fixture.client.close;
    }),
);

it.effect(
  "control-plane targets and commands are checked before acquiring any additional socket",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled();
      expect(
        yield* Effect.flip(fixture.client.sentinel(-1).execute(Commands.sentinelMyId())),
      ).toMatchObject({ reason: "routing", plane: "sentinel" });
      expect(
        yield* Effect.flip(fixture.client.sentinel(0).execute(Commands.get("key"))),
      ).toMatchObject({ reason: "routing", plane: "sentinel" });
      expect(
        yield* Effect.flip(fixture.client.redis.execute(Commands.sentinelMasters())),
      ).toMatchObject({ reason: "execution-mode" });
      expect(fixture.acquired()).toBe(2);
    }),
);
