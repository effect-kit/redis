import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Inspectable, Redacted, Stream } from "effect";

import { decodeRedisConfig, makeRedisMonitor } from "#/index";
import { bytes, sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

const config = () => decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
const line = '+1723000000.123456 [0 127.0.0.1:123] "SET" "private-key" "value"\r\n';

it.effect("MONITOR: acknowledgment and coalesced lines share a dedicated diagnostic reader", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const opening = yield* Effect.forkChild(
      makeRedisMonitor(yield* config()).pipe(Effect.provide(physical.layer)),
    );
    yield* sent(physical, ["MONITOR"], `+OK\r\n${line}`);
    const monitor = yield* Fiber.join(opening);
    const events = yield* Stream.runCollect(monitor.events.pipe(Stream.take(1)));

    expect(events[0]).toMatchObject({ _tag: "Command", database: 0n });
    expect(events[0]?._tag === "Command" && Redacted.value(events[0].commandLine)).toContain(
      "private-key",
    );
    expect(Inspectable.toStringUnknown(events)).not.toContain("private-key");
    yield* monitor.close;
    yield* monitor.close;
    expect(yield* physical.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect(
  "MONITOR: overflow fails explicitly and retires instead of dropping diagnostic lines",
  () =>
    Effect.gen(function* () {
      const physical = yield* makeControlledTransport();
      const opening = yield* Effect.forkChild(
        makeRedisMonitor(yield* config(), { maxMessages: 1 }).pipe(Effect.provide(physical.layer)),
      );
      yield* sent(physical, ["MONITOR"], `+OK\r\n${line}${line}`);
      const monitor = yield* Fiber.join(opening);

      expect(yield* Effect.flip(Stream.runCollect(monitor.events))).toMatchObject({
        _tag: "DiagnosticError",
        reason: "overflow",
      });
      yield* monitor.close;
      expect(yield* physical.observations).toMatchObject({ closed: 1 });
    }),
);

it.effect("MONITOR: simultaneous consumers fail and explicit close ends the owner stream", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const opening = yield* Effect.forkChild(
      makeRedisMonitor(yield* config()).pipe(Effect.provide(physical.layer)),
    );
    yield* sent(physical, ["MONITOR"], "+OK\r\n");
    const monitor = yield* Fiber.join(opening);
    const first = yield* Effect.forkChild(Stream.runDrain(monitor.events));
    yield* Effect.yieldNow;

    expect(yield* Effect.flip(Stream.runDrain(monitor.events))).toMatchObject({
      _tag: "DiagnosticError",
      reason: "concurrent-consumer",
    });
    yield* monitor.close;
    yield* Fiber.join(first);
  }),
);

it.effect("MONITOR: denied acquisition and cancellation cannot leave a usable event socket", () =>
  Effect.gen(function* () {
    const denied = yield* makeControlledTransport();
    const opening = yield* Effect.forkChild(
      Effect.flip(makeRedisMonitor(yield* config()).pipe(Effect.provide(denied.layer))),
    );
    yield* sent(denied, ["MONITOR"], "-NOPERM diagnostic denied\r\n");
    expect(yield* Fiber.join(opening)).toMatchObject({ _tag: "ServerError", code: "NOPERM" });

    const cancelled = yield* makeControlledTransport();
    const waiting = yield* Effect.forkChild(
      makeRedisMonitor(yield* config()).pipe(Effect.provide(cancelled.layer)),
    );
    const attempt = yield* cancelled.nextWrite;
    yield* attempt.accept(attempt.bytes.length);
    yield* Fiber.interrupt(waiting);
    expect(yield* cancelled.observations).toMatchObject({ closed: 1 });
  }),
);

it.effect("MONITOR: clean EOF terminates the stream without silent reconnection", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const opening = yield* Effect.forkChild(
      makeRedisMonitor(yield* config()).pipe(Effect.provide(physical.layer)),
    );
    yield* sent(physical, ["MONITOR"], "+OK\r\n");
    const monitor = yield* Fiber.join(opening);
    yield* physical.receive(bytes("+unrecognized\r\n"));
    expect(yield* Stream.runCollect(monitor.events.pipe(Stream.take(1)))).toMatchObject([
      { _tag: "Unknown" },
    ]);
    yield* physical.end;
    expect(yield* Effect.flip(Stream.runDrain(monitor.events))).toMatchObject({
      _tag: "ConnectionError",
      reason: "closed",
    });
  }),
);

it.effect("MONITOR: the configured diagnostic line bound retires oversized event framing", () =>
  Effect.gen(function* () {
    const physical = yield* makeControlledTransport();
    const opening = yield* Effect.forkChild(
      makeRedisMonitor(yield* config(), { maxLineBytes: 128 }).pipe(Effect.provide(physical.layer)),
    );
    yield* sent(physical, ["MONITOR"], "+OK\r\n");
    const monitor = yield* Fiber.join(opening);
    yield* physical.receive(
      bytes(`+1723000000.123456 [0 local] "SET" "key" "${"x".repeat(256)}"\r\n`),
    );

    expect(yield* Effect.flip(Stream.runDrain(monitor.events))).toMatchObject({
      _tag: "ConnectionError",
      reason: "protocol",
    });
    yield* monitor.close;
    expect(yield* physical.observations).toMatchObject({ closed: 1 });
  }),
);
