import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Scope } from "effect";

import { decodeRedisConfig, makeRedisMonitor, makeRedisShutdown, Transport } from "#/index";
import { reconnecting, sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

const config = () => decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });

const failingCleanup = Effect.fnUntraced(function* () {
  const fixture = yield* makeControlledTransport();
  const native = yield* Transport.pipe(Effect.provide(fixture.layer));
  const layer = Layer.succeed(Transport, {
    open: (selected) =>
      native.open(selected).pipe(
        Effect.map((physical) => ({
          ...physical,
          close: physical.close.pipe(Effect.andThen(Effect.die("diagnostic-cleanup"))),
        })),
      ),
  });

  return { fixture, layer };
});

it.effect(
  "MONITOR: physical cleanup defects remain visible at manual and service scope closure",
  () =>
    Effect.gen(function* () {
      const { fixture, layer } = yield* failingCleanup();
      const ownerScope = yield* Scope.make();
      const opening = yield* Effect.forkChild(
        makeRedisMonitor(yield* config()).pipe(Scope.provide(ownerScope), Effect.provide(layer)),
      );
      yield* sent(fixture, ["MONITOR"], "+OK\r\n");
      const monitor = yield* Fiber.join(opening);
      const closed = yield* Effect.exit(monitor.close);

      expect(Exit.isFailure(closed)).toBe(true);
      if (Exit.isFailure(closed)) expect(Cause.hasDies(closed.cause)).toBe(true);
      const disposed = yield* Effect.exit(Scope.close(ownerScope, Exit.void));
      expect(Exit.isFailure(disposed)).toBe(true);
    }),
);

it.effect("SHUTDOWN: cleanup defects cannot turn an observed EOF into a successful result", () =>
  Effect.gen(function* () {
    const { fixture, layer } = yield* failingCleanup();
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(layer));
    const request = yield* Effect.forkChild(Effect.exit(service.shutdown()));
    yield* sent(fixture, ["SHUTDOWN"]);
    yield* fixture.end;
    const closed = yield* Fiber.join(request);

    expect(Exit.isFailure(closed)).toBe(true);
    if (Exit.isFailure(closed)) expect(Cause.hasDies(closed.cause)).toBe(true);
    const replacement = yield* Effect.exit(service.abort());
    expect(Exit.isFailure(replacement)).toBe(true);
    if (Exit.isFailure(replacement)) expect(Cause.hasDies(replacement.cause)).toBe(true);
  }),
);

it.effect("SHUTDOWN: a second caller cannot open a competing control connection", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(fixture.layer));
    const first = yield* Effect.forkChild(service.shutdown());
    yield* sent(fixture, ["SHUTDOWN"]);

    expect(yield* Effect.flip(service.shutdown())).toMatchObject({
      _tag: "AdmissionError",
      reason: "count",
      delivery: "unsent",
    });
    yield* fixture.end;
    expect(yield* Fiber.join(first)).toEqual({ _tag: "ConnectionClosed", execution: "unknown" });
    expect(yield* fixture.written).toHaveLength(1);
  }),
);

it.effect("SHUTDOWN: a separately bounded ABORT can cancel a pending shutdown", () =>
  Effect.gen(function* () {
    const fixture = yield* reconnecting();
    const [primary, secondary] = fixture.fixtures;
    if (primary === undefined || secondary === undefined)
      return yield* Effect.die("Missing control fixtures");
    const service = yield* makeRedisShutdown(yield* config()).pipe(Effect.provide(fixture.layer));
    const first = yield* Effect.forkChild(Effect.flip(service.shutdown()));
    yield* sent(primary, ["SHUTDOWN"]);
    const abort = yield* Effect.forkChild(service.abort());
    yield* sent(secondary, ["SHUTDOWN", "ABORT"], "+OK\r\n");
    yield* primary.receive(new TextEncoder().encode("-SHUTDOWN Shutdown manually aborted.\r\n"));

    expect(yield* Fiber.join(abort)).toBeUndefined();
    expect(yield* Fiber.join(first)).toMatchObject({ _tag: "ServerError", code: "SHUTDOWN" });
    expect(fixture.opens()).toBe(2);
  }),
);
