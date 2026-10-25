import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { makeConnection } from "#/connection/Connection";
import { RoleExpectation } from "#/connection/Role";
import { decodeRedisConfig } from "#/RedisConfig";
import { makeRedisPubSub } from "#/subscriptions/RedisPubSub";
import { sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

const primary = "*3\r\n$6\r\nmaster\r\n:0\r\n*0\r\n";

it.effect(
  "role policy is captured before application admission and survives the construction context",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const config = yield* decodeRedisConfig({ endpoint: { host: "data" }, protocol: "resp2" });
      const opening = yield* Effect.forkChild(
        makeConnection(config).pipe(
          Effect.provide(fixture.layer),
          Effect.provideService(RoleExpectation, "primary"),
        ),
      );

      yield* sent(fixture, ["ROLE"], primary);
      const connection = yield* Fiber.join(opening);
      const ping = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(fixture, ["PING"], "+PONG\r\n");

      expect((yield* Fiber.join(ping))._tag).toBe("SimpleString");
      expect((yield* fixture.observations).acquired).toBe(1);
    }),
);

it.effect("a wrong data role closes acquisition before commands can enter the FIFO", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "data" }, protocol: "resp2" });
    const opening = yield* Effect.forkChild(
      Effect.flip(
        makeConnection(config).pipe(
          Effect.provide(fixture.layer),
          Effect.provideService(RoleExpectation, "replica"),
        ),
      ),
    );

    yield* sent(fixture, ["ROLE"], primary);

    expect(yield* Fiber.join(opening)).toMatchObject({
      stage: "role",
      reason: "role-mismatch",
      delivery: "unsent",
    });
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("lazy event owners retain role policy when subscribed from another context", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "data" }, protocol: "resp2" });
    const client = yield* makeRedisPubSub(config).pipe(
      Effect.provide(fixture.layer),
      Effect.provideService(RoleExpectation, "primary"),
    );
    const subscribing = yield* Effect.forkChild(client.subscribe(["events"]));

    yield* sent(fixture, ["ROLE"], primary);
    yield* sent(
      fixture,
      ["SUBSCRIBE", "events"],
      "*3\r\n$9\r\nsubscribe\r\n$6\r\nevents\r\n:1\r\n",
    );

    yield* Fiber.join(subscribing);

    expect(yield* client.snapshot).toMatchObject({ listeners: 1 });
  }),
);
