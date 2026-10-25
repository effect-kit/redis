import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { decodeRedisConfig, makeRedisShutdown, TransportError } from "#/index";
import { sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

const config = (protocol = "resp2") =>
  decodeRedisConfig({ endpoint: { host: "localhost" }, protocol });

it.effect(
  "SHUTDOWN: clean EOF is an observed close with an explicitly unknown execution outcome",
  () =>
    Effect.gen(function* () {
      const physical = yield* makeControlledTransport();
      const service = yield* makeRedisShutdown(yield* config()).pipe(
        Effect.provide(physical.layer),
      );
      const request = yield* Effect.forkChild(
        service.shutdown({ save: "NOSAVE", now: true, force: true }),
      );

      yield* sent(physical, ["SHUTDOWN", "NOSAVE", "NOW", "FORCE"]);
      yield* physical.end;
      expect(yield* Fiber.join(request)).toEqual({
        _tag: "ConnectionClosed",
        execution: "unknown",
      });
      expect(yield* physical.observations).toMatchObject({ closed: 1 });
    }),
);

it.effect("SHUTDOWN: ABORT owns its ordinary OK response", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(physical.layer));
    const request = yield* Effect.forkChild(service.abort());
    yield* sent(physical, ["SHUTDOWN", "ABORT"], "+OK\r\n");
    expect(yield* Fiber.join(request)).toBeUndefined();
    expect(yield* physical.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect.each(["NOPERM denied", "ERR unknown option"])(
  "SHUTDOWN: %s remains an error",
  (message) =>
    Effect.gen(function* () {
      const physical = yield* makeControlledTransport();
      const service = yield* makeRedisShutdown(yield* config()).pipe(
        Effect.provide(physical.layer),
      );
      const request = yield* Effect.forkChild(Effect.flip(service.shutdown()));
      yield* sent(physical, ["SHUTDOWN"], `-${message}\r\n`);

      expect(yield* Fiber.join(request)).toMatchObject({ _tag: "ServerError" });
      expect(yield* physical.written).toHaveLength(1);
    }),
);

it.effect("SHUTDOWN: reset/transport loss is not a successful close receipt", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(physical.layer));
    const request = yield* Effect.forkChild(Effect.flip(service.shutdown()));
    yield* sent(physical, ["SHUTDOWN"]);
    yield* physical.failRead(new TransportError({ stage: "read", reason: "io" }));

    expect(yield* Fiber.join(request)).toMatchObject({
      _tag: "ConnectionError",
      reason: "transport",
      delivery: "possibly-written",
    });
  }),
);

it.effect("SHUTDOWN: EOF before HELLO completion cannot stand in for command execution", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const service = yield* makeRedisShutdown(yield* config("resp3")).pipe(
      Effect.provide(physical.layer),
    );
    const request = yield* Effect.forkChild(Effect.flip(service.shutdown()));
    yield* sent(physical, ["HELLO", "3"]);
    yield* physical.end;

    expect(yield* Fiber.join(request)).toMatchObject({
      _tag: "ConnectionError",
      delivery: "unsent",
    });
    expect(yield* physical.written).toHaveLength(1);
  }),
);

it.effect("SHUTDOWN: cancellation after write retires ownership without replay", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(physical.layer));
    const request = yield* Effect.forkChild(service.shutdown());
    yield* sent(physical, ["SHUTDOWN"]);
    yield* Fiber.interrupt(request);

    expect(yield* physical.observations).toMatchObject({ closed: 1 });
    expect(yield* physical.written).toHaveLength(1);
  }),
);
