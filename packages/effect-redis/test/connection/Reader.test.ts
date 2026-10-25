import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import { makeConnection } from "../../src/connection/Connection.js";
import { TransportError } from "../../src/errors/TransportError.js";
import { decodeRedisConfig } from "../../src/RedisConfig.js";
import { Transport } from "../../src/transport/Transport.js";
import { controlled, bytes, sent, waitForSnapshot } from "../support/connection/Controlled.js";
import { makeControlledTransport } from "../support/transport/ControlledTransport.js";

it.effect(
  "OWNERSHIP-02: a fast reply before write completion keeps accounting owned until write returns",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const service = yield* Transport.pipe(Effect.provide(fixture.layer));
      const gate = yield* Deferred.make<void>();
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const connection = yield* makeConnection(config).pipe(
        Effect.provideService(Transport, {
          open: (cfg) =>
            service.open(cfg).pipe(
              Effect.map((physical) => ({
                ...physical,
                write: (frame) => physical.write(frame).pipe(Effect.andThen(Deferred.await(gate))),
              })),
            ),
        }),
      );
      const request = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(fixture, ["PING"], "+PONG\r\n");
      expect(yield* Fiber.join(request)).toEqual({ _tag: "SimpleString", value: bytes("PONG") });
      expect(yield* connection.snapshot).toMatchObject({ inFlightCommands: 1 });
      yield* Deferred.succeed(gate, undefined);
      yield* connection.close;
      expect(yield* connection.snapshot).toMatchObject({ inFlightCommands: 0, inFlightBytes: 0 });
    }),
);

it.effect(
  "OWNERSHIP-03: decorated pushes never take reply slots and attributes stay attached",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const a = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(fixture, ["PING"]);
      yield* fixture.receive(
        bytes("|1\r\n+source\r\n+test\r\n>2\r\n+notice\r\n:7\r\n|1\r\n+ttl\r\n:9\r\n+PONG\r\n"),
      );
      expect((yield* Fiber.join(a))._tag).toBe("Attribute");
      const push = yield* connection.takePush;
      expect(push.generation).toBe(1);
      expect(push.value._tag).toBe("Attribute");
      if (push.value._tag === "Attribute") expect(push.value.value._tag).toBe("Push");
      expect((yield* connection.snapshot).pushBytes).toBe(0);
    }),
);

it.effect.each([{ maxPushMessages: 1 }, { maxPushBytes: 8 }])(
  "OWNERSHIP-04: push overflow retires the generation without blocking the reader %#",
  (options) =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled({}, options);
      const request = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
      yield* sent(fixture, ["PING"]);
      yield* fixture.receive(bytes(">1\r\n+first\r\n>1\r\n+second\r\n+PONG\r\n"));
      const result = yield* Fiber.join(request);
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "ConnectionError",
        reason: "push-overflow",
        delivery: "possibly-written",
      });
      const push = yield* Effect.result(connection.takePush);
      expect(Result.isFailure(push) && push.failure.reason).toBe("push-overflow");
    }),
);

it.effect.each([":invalid\r\n", "$3\r\na"])(
  "OWNERSHIP-05: malformed/truncated replies fail pending callers with write evidence %#",
  (reply) =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const request = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
      yield* sent(fixture, ["PING"]);
      yield* fixture.receive(bytes(reply));
      yield* fixture.end;
      const result = yield* Fiber.join(request);
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "ConnectionError",
        reason: "protocol",
        delivery: "possibly-written",
      });
    }),
);

it.effect("LIMIT-16: a coalesced transport chunk is partitioned to parser capacity", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({
      limits: { maxBufferedBytes: 32, maxBlobBytes: 16, maxHeaderBytes: 8 },
    });
    const fibers = [];
    for (let index = 0; index < 20; index++) {
      fibers.push(yield* Effect.forkChild(connection.executeOrdinary(["PING"])));
      yield* sent(fixture, ["PING"]);
    }
    yield* fixture.receive(bytes("+PONG\r\n".repeat(20)));
    const replies = yield* Effect.forEach(fibers, Fiber.join);
    expect(replies).toHaveLength(20);
    expect((yield* connection.snapshot).replies).toBe(20);
  }),
);

it.effect(
  "OWNERSHIP-13: write failure after a known reply cannot turn that reply into uncertainty",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const service = yield* Transport.pipe(Effect.provide(fixture.layer));
      const fail = yield* Deferred.make<void>();
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const connection = yield* makeConnection(config).pipe(
        Effect.provideService(Transport, {
          open: (cfg) =>
            service.open(cfg).pipe(
              Effect.map((physical) => {
                const write = Effect.fnUntraced(function* (frame: Uint8Array) {
                  yield* physical.write(frame);
                  yield* Deferred.await(fail);
                  return yield* new TransportError({ stage: "write", reason: "io" });
                });
                return { ...physical, write };
              }),
            ),
        }),
      );
      const known = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
      yield* sent(fixture, ["PING"], "+PONG\r\n");
      expect(yield* Fiber.join(known)).toEqual({ _tag: "SimpleString", value: bytes("PONG") });
      const queued = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
      yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
      yield* Deferred.succeed(fail, undefined);
      const outcome = yield* Fiber.join(queued);
      expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
        _tag: "ConnectionError",
        delivery: "unsent",
      });
      expect(yield* connection.snapshot).toMatchObject({ unknownOutcomes: 0, inFlightCommands: 0 });
    }),
);

it.effect("OWNERSHIP-14: a stalled write callback after a known reply still has a deadline", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      protocol: "resp2",
      commandTimeoutMillis: 100,
    });
    const connection = yield* makeConnection(config).pipe(
      Effect.provideService(Transport, {
        open: (cfg) =>
          service.open(cfg).pipe(
            Effect.map((physical) => {
              const write = Effect.fnUntraced(function* (frame: Uint8Array) {
                yield* physical.write(frame);
                yield* Effect.never;
              });
              return { ...physical, write };
            }),
          ),
      }),
    );
    const known = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
    yield* sent(fixture, ["PING"], "+PONG\r\n");
    expect(yield* Fiber.join(known)).toEqual({ _tag: "SimpleString", value: bytes("PONG") });
    const queued = yield* Effect.forkChild(Effect.result(connection.executeOrdinary(["PING"])));
    yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(queued);
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "ConnectionError",
      delivery: "unsent",
    });
    yield* connection.abort;
    expect(yield* connection.snapshot).toMatchObject({
      inFlightBytes: 0,
      queuedBytes: 0,
      unknownOutcomes: 0,
    });
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);
