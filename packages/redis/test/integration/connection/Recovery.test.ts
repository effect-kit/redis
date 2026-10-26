import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Redacted, Ref, Result } from "effect";
import { TestClock } from "effect/testing";

import { makeConnection } from "#/connection/Connection";
import { HandshakeError } from "#/errors/HandshakeError";
import { TransportError } from "#/errors/TransportError";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import { reconnecting, sent, waitForSnapshot } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect("UNKNOWN-02: future work reconnects; queued and written old work is never replayed", () =>
  Effect.gen(function* () {
    const fixture = yield* reconnecting();
    const first = fixture.fixtures[0];
    const second = fixture.fixtures[1];
    if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");

    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      protocol: "resp2",
      limits: { maxInFlightCommands: 1 },
    });
    const connection = yield* makeConnection(config, { reconnectAttempts: 1 }).pipe(
      Effect.provide(fixture.layer),
    );

    const written = yield* Effect.forkChild(
      Effect.result(connection.executeOrdinary(["INCR", "counter"])),
    );
    yield* sent(first, ["INCR", "counter"]);
    const queued = yield* Effect.forkChild(
      Effect.result(connection.executeOrdinary(["INCR", "unsent"])),
    );
    yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
    yield* first.end;

    const a = yield* Fiber.join(written);
    const b = yield* Fiber.join(queued);

    expect(Result.isFailure(a) && a.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "possibly-written",
      generation: 1,
    });
    expect(Result.isFailure(b) && b.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "unsent",
      generation: 1,
    });

    const fresh = yield* Effect.forkChild(connection.executeOrdinary(["GET", "counter"]));
    yield* sent(second, ["GET", "counter"], ":1\r\n");
    expect(yield* Fiber.join(fresh)).toEqual({ _tag: "Integer", value: 1n });
    expect(fixture.opens()).toBe(2);
    expect((yield* first.observations).closed).toBe(1);
    expect(yield* second.written).toHaveLength(1);
    yield* first.failRead(new TransportError({ stage: "read", reason: "io" }));
    expect(yield* connection.snapshot).toMatchObject({ state: "ready", generation: 2 });
  }),
);

it.effect(
  "HANDSHAKE-08: reconnect reacquires credentials and repeats AUTH before future work",
  () =>
    Effect.gen(function* () {
      const fixture = yield* reconnecting();
      const [first, second] = fixture.fixtures;
      if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");
      const calls = yield* Ref.make(0);

      const credentials = Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) => ({ password: Redacted.make(`synthetic-${count}`) })),
      );
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });

      const opening = yield* Effect.forkChild(
        makeConnection(config, { credentials }).pipe(Effect.provide(fixture.layer)),
      );
      yield* sent(first, ["AUTH", "synthetic-1"], "+OK\r\n");
      const connection = yield* Fiber.join(opening);

      yield* first.end;
      yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");
      const request = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(second, ["AUTH", "synthetic-2"], "+OK\r\n");
      yield* sent(second, ["PING"], "+PONG\r\n");
      yield* Fiber.join(request);
      expect(yield* Ref.get(calls)).toBe(2);
    }),
);

it.effect("HANDSHAKE-09: transport acquisition retries are finite and clock-controlled", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const attempts = yield* Ref.make(0);
    const attempted = yield* Deferred.make<void>();

    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
    const opening = yield* Effect.forkChild(
      makeConnection(config, { reconnectAttempts: 2, reconnectDelayMillis: 100 }).pipe(
        Effect.provideService(Transport, {
          open: (cfg) =>
            Effect.gen(function* () {
              const count = yield* Ref.updateAndGet(attempts, (previous) => previous + 1);
              if (count === 1) {
                yield* Deferred.succeed(attempted, undefined);
                return yield* new TransportError({ stage: "open", reason: "unavailable" });
              }
              return yield* service.open(cfg);
            }),
        }),
      ),
    );

    yield* Deferred.await(attempted);
    expect(opening.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(100);
    const connection = yield* Fiber.join(opening);
    expect(yield* connection.snapshot).toMatchObject({ connectionAttempts: 2, generation: 2 });

    let permanentAttempts = 0;
    const permanent = yield* Effect.result(
      makeConnection(config).pipe(
        Effect.provideService(Transport, {
          open: () =>
            Effect.suspend(() => {
              permanentAttempts++;
              return Effect.fail(new TransportError({ stage: "open", reason: "limit" }));
            }),
        }),
      ),
    );

    expect(Result.isFailure(permanent) && permanent.failure).toMatchObject({
      _tag: "TransportError",
      reason: "limit",
    });
    expect(permanentAttempts).toBe(1);
  }),
);

it.effect("HANDSHAKE-10: credential provider errors never become reconnect loops", () =>
  Effect.gen(function* () {
    const fixture = yield* reconnecting();

    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
    const result = yield* Effect.result(
      makeConnection(config, {
        credentials: Effect.fail(
          new HandshakeError({
            delivery: "unsent",
            stage: "credentials",
            reason: "unavailable",
            cause: Redacted.make("synthetic-secret"),
          }),
        ),
      }).pipe(Effect.provide(fixture.layer)),
    );
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "HandshakeError",
      stage: "credentials",
    });
    expect(fixture.opens()).toBe(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  }),
);

it.effect("OWNERSHIP-06: worker defects reach callers and cannot be hidden by reconnect", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const crash = yield* Deferred.make<void>();

    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
    const connection = yield* makeConnection(config).pipe(
      Effect.provideService(Transport, {
        open: (cfg) =>
          service.open(cfg).pipe(
            Effect.map((physical) => ({
              ...physical,
              read: Deferred.await(crash).pipe(
                Effect.andThen(Effect.die(new Error("synthetic-defect"))),
              ),
            })),
          ),
      }),
    );

    const request = yield* Effect.forkChild(Effect.exit(connection.executeOrdinary(["PING"])));
    yield* sent(fixture, ["PING"]);
    yield* Deferred.succeed(crash, undefined);
    expect(Exit.hasDies(yield* Fiber.join(request))).toBe(true);

    const future = yield* Effect.exit(connection.executeOrdinary(["PING"]));
    expect(Exit.isFailure(future) && Cause.hasDies(future.cause)).toBe(true);
    expect((yield* fixture.observations).acquired).toBe(1);
  }),
);

it.effect(
  "ADMISSION-06: cancel while reconnecting never sends that request on the replacement",
  () =>
    Effect.gen(function* () {
      const fixtures = yield* reconnecting();
      const first = fixtures.fixtures[0];
      const second = fixtures.fixtures[1];
      if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");
      const service = yield* Transport.pipe(Effect.provide(fixtures.layer));
      const gate = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let opens = 0;
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
        limits: { maxQueuedCommands: 1 },
      });
      const connection = yield* makeConnection(config).pipe(
        Effect.provideService(Transport, {
          open: (cfg) =>
            Effect.gen(function* () {
              if (++opens === 2) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(gate);
              }
              return yield* service.open(cfg);
            }),
        }),
      );

      yield* first.end;
      yield* waitForSnapshot(connection, (snapshot) => snapshot.state === "failed");

      const canceled = yield* Effect.forkChild(
        connection.executeOrdinary(["INCR", "never-written"]),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(canceled);
      expect(yield* connection.snapshot).toMatchObject({ queuedCommands: 0, inFlightCommands: 0 });

      const fresh = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
      yield* Deferred.succeed(gate, undefined);
      yield* sent(second, ["PING"], "+PONG\r\n");
      yield* Fiber.join(fresh);
      expect(yield* second.written).toHaveLength(1);
    }),
);

it.effect(
  "OWNERSHIP-12: cleanup defects prevent replacement sockets and propagate through scope exit",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const service = yield* Transport.pipe(Effect.provide(fixture.layer));
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const scopeExit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* makeConnection(config).pipe(
              Effect.provideService(Transport, {
                open: (cfg) =>
                  Effect.gen(function* () {
                    const physical = yield* service.open(cfg);
                    yield* Effect.addFinalizer(() =>
                      Effect.die(new Error("synthetic-close-defect")),
                    );
                    return physical;
                  }),
              }),
            );
            const request = yield* Effect.forkChild(
              Effect.result(connection.executeOrdinary(["PING"])),
            );
            yield* sent(fixture, ["PING"]);
            yield* fixture.end;
            yield* Fiber.join(request);
            const future = yield* Effect.exit(connection.executeOrdinary(["PING"]));
            expect(Exit.hasDies(future)).toBe(true);
            expect((yield* fixture.observations).acquired).toBe(1);
          }),
        ),
      );

      expect(Exit.hasDies(scopeExit)).toBe(true);
      expect((yield* fixture.observations).closed).toBe(1);
    }),
);
