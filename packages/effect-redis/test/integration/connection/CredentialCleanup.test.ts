import { expect, it } from "@effect/vitest";
import { Clock, Context, Effect, Exit, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { nativeLayers } from "#/client/Native";
import { TransportError } from "#/errors/TransportError";
import { Redis } from "#/index";
import { cryptoLayer } from "#/platform/node/Crypto";
import { Transport } from "#/transport/Transport";
import { sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect(
  "retirement cleanup failure poisons replacement acquisition and remains a scope defect",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const transport = yield* Transport.pipe(Effect.provide(fixture.layer));
      let opens = 0;
      const failing = Layer.succeed(Transport, {
        open: (config) =>
          transport.open(config).pipe(
            Effect.map((physical) => {
              opens++;
              return {
                ...physical,
                close: physical.close.pipe(
                  Effect.andThen(
                    Effect.fail(new TransportError({ stage: "close", reason: "unavailable" })),
                  ),
                ),
              };
            }),
          ),
      });
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              nativeLayers(failing, cryptoLayer).layer({
                url: "redis://localhost",
                protocol: "resp2",
                credentialLifetime: { mode: "max-age", maxAgeMillis: 1000 },
              }),
            );
            yield* TestClock.adjust(1000);
            const future = yield* Effect.exit(Context.get(context, Redis).ping());
            expect(Exit.hasDies(future)).toBe(true);
            expect(opens).toBe(1);
          }),
        ),
      );
      expect(Exit.hasDies(exit)).toBe(true);
    }),
);

it.effect("distant token expiries do not overflow the host timer into immediate retirement", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const opening = yield* Layer.build(
      nativeLayers(fixture.layer, cryptoLayer).layer({
        url: "redis://localhost",
        protocol: "resp2",
        credentials: Effect.gen(function* () {
          return {
            password: Redacted.make("synthetic"),
            expiresAtMillis: (yield* Clock.currentTimeMillis) + 4_000_000_000,
          };
        }),
        credentialLifetime: { mode: "token-expiry", retireBeforeMillis: 0 },
      }),
    ).pipe(Effect.forkChild);
    yield* sent(fixture, ["AUTH", "synthetic"], "+OK\r\n");
    const context = yield* Fiber.join(opening);
    yield* TestClock.adjust(86_400_000);
    expect((yield* fixture.observations).closed).toBe(0);
    const ping = yield* Context.get(context, Redis).ping().pipe(Effect.forkChild);
    yield* sent(fixture, ["PING"], "+PONG\r\n");
    yield* Fiber.join(ping);
  }),
);
