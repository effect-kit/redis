import { expect, it } from "@effect/vitest";
import { Clock, Context, Effect, Fiber, Layer, Redacted } from "effect";

import { nativeLayers } from "#/client/Native";
import { Redis, RedisCredentials, RedisSentinelCredentials } from "#/index";
import { cryptoLayer } from "#/platform/node/Crypto";
import { sent } from "#test/support/connection/Controlled";
import { addressReply, primaryRole, sentinelTransport } from "#test/support/sentinel/Controlled";

it.effect("ready Sentinel Layers isolate cached control/data identities and their rotation", () =>
  Effect.gen(function* () {
    const fixture = yield* sentinelTransport();
    const calls = { control: 0, data: 0 };
    const source = (plane: "control" | "data") =>
      RedisCredentials.provider(
        Effect.gen(function* () {
          return {
            password: Redacted.make(`synthetic-${plane}-${++calls[plane]}`),
            expiresAtMillis: (yield* Clock.currentTimeMillis) + 100_000,
          };
        }),
      );
    const opening = yield* Layer.build(
      nativeLayers(fixture.layer, cryptoLayer).layerSentinel({
        serviceName: "cache",
        sentinels: [{ endpoint: { host: "s1" }, protocol: "resp2" }],
        data: { protocol: "resp2" },
        credentials: source("data"),
        sentinelCredentials: source("control"),
        sentinel: { discoveryAttempts: 1 },
      }),
    ).pipe(Effect.forkChild);
    const discover = (controlToken: number, dataToken: number) =>
      Effect.gen(function* () {
        const control = yield* fixture.next;
        yield* sent(control.fixture, ["AUTH", `synthetic-control-${controlToken}`], "+OK\r\n");
        yield* sent(
          control.fixture,
          ["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"],
          addressReply(),
        );
        const probe = yield* fixture.next;
        yield* sent(probe.fixture, ["AUTH", `synthetic-data-${dataToken}`], "+OK\r\n");
        yield* sent(probe.fixture, ["ROLE"], primaryRole);
      });
    yield* discover(1, 1);
    const context = yield* Fiber.join(opening);
    const redis = Context.get(context, Redis);
    const dataIdentity = Context.get(context, RedisCredentials);
    const controlIdentity = Context.get(context, RedisSentinelCredentials);
    expect(calls).toEqual({ control: 1, data: 1 });

    const first = yield* redis.ping().pipe(Effect.forkChild);
    yield* discover(1, 1);
    const physical = yield* fixture.next;
    yield* sent(physical.fixture, ["AUTH", "synthetic-data-1"], "+OK\r\n");
    yield* sent(physical.fixture, ["ROLE"], primaryRole);
    yield* sent(physical.fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(first);

    yield* controlIdentity.rotate;
    expect((yield* controlIdentity.snapshot).coordinator?.revision).toBe(1);
    expect((yield* dataIdentity.snapshot).revision).toBe(0);
    expect((yield* physical.fixture.observations).closed).toBe(0);
    const healthy = yield* redis.ping().pipe(Effect.forkChild);
    yield* sent(physical.fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(healthy);
    expect(calls).toEqual({ control: 1, data: 1 });

    yield* dataIdentity.rotate;
    expect((yield* physical.fixture.observations).closed).toBe(1);
    const future = yield* redis.ping().pipe(Effect.forkChild);
    yield* discover(2, 2);
    const replacement = yield* fixture.next;
    yield* sent(replacement.fixture, ["AUTH", "synthetic-data-2"], "+OK\r\n");
    yield* sent(replacement.fixture, ["ROLE"], primaryRole);
    yield* sent(replacement.fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(future);
    expect(calls).toEqual({ control: 2, data: 2 });
  }),
);
