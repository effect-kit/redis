import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import { TransportError } from "../../src/errors/TransportError.js";
import { decodeRedisConfig } from "../../src/RedisConfig.js";
import { Transport } from "../../src/transport/Transport.js";
import { makeControlledTransport } from "../support/transport/ControlledTransport.js";

const config = decodeRedisConfig({ endpoint: { host: "localhost" } });

it.effect("TRANSPORT-01: fragments and EOF pass through without text coercion", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const connection = yield* service.open(yield* config);
    const chunk = new Uint8Array([0, 255]);
    yield* fixture.receive(chunk);
    chunk[0] = 8;
    yield* fixture.receive(new Uint8Array([13]));
    yield* fixture.end;
    expect(yield* connection.read).toEqual(new Uint8Array([0, 255]));
    expect(yield* connection.read).toEqual(new Uint8Array([13]));
    expect(yield* connection.read).toBeUndefined();
    expect(yield* connection.read).toBeUndefined();
  }),
);

it.effect("TRANSPORT-02: partial acceptance retains backpressure and snapshots bytes", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const connection = yield* service.open(yield* config);
    const bytes = new Uint8Array([1, 2, 3]);
    const writer = yield* Effect.forkChild(connection.write(bytes));
    const attempt = yield* fixture.nextWrite;
    bytes[0] = 9;
    yield* attempt.accept(1);
    expect(writer.pollUnsafe()).toBeUndefined();
    yield* attempt.accept(2);
    yield* Fiber.join(writer);
    expect(yield* fixture.written).toEqual([new Uint8Array([1]), new Uint8Array([2, 3])]);
  }),
);

it.effect("TRANSPORT-03: write errors preserve the failure after an accepted prefix", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const connection = yield* service.open(yield* config);
    const writer = yield* Effect.forkChild(Effect.result(connection.write(new Uint8Array([1, 2]))));
    const attempt = yield* fixture.nextWrite;
    yield* attempt.accept(1);
    const error = new TransportError({ stage: "write", reason: "io" });
    yield* attempt.fail(error);
    expect(yield* Fiber.join(writer)).toEqual(Result.fail(error));
    expect((yield* fixture.observations).acceptedBytes).toBe(1);
  }),
);

it.effect("TRANSPORT-04: close wakes readers/writers and finalizes only once", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* service.open(yield* config);
        const reader = yield* Effect.forkChild(Effect.result(connection.read));
        const writer = yield* Effect.forkChild(
          Effect.result(connection.write(new Uint8Array([1]))),
        );
        yield* fixture.nextWrite;
        yield* connection.close;
        yield* connection.close;
        expect(Result.isFailure(yield* Fiber.join(reader))).toBe(true);
        expect(Result.isFailure(yield* Fiber.join(writer))).toBe(true);
      }),
    );
    expect(yield* fixture.observations).toEqual({ acquired: 1, closed: 1, acceptedBytes: 0 });
  }),
);

it.effect("TRANSPORT-05: interrupted writes release the waiter and scope closes the handle", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* service.open(yield* config);
        const writer = yield* Effect.forkChild(
          Effect.result(connection.write(new Uint8Array([1])).pipe(Effect.timeout("1 second"))),
        );
        yield* fixture.nextWrite;
        yield* TestClock.adjust("1 second");
        expect(Result.isFailure(yield* Fiber.join(writer))).toBe(true);
      }),
    );
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("TRANSPORT-06: injected read failures and bounded captures remain explicit", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const connection = yield* service.open(yield* config);
    const error = new TransportError({ stage: "read", reason: "io" });
    yield* fixture.failRead(error);
    expect(yield* Effect.result(connection.read)).toEqual(Result.fail(error));
    expect(Result.isFailure(yield* Effect.result(fixture.receive(new Uint8Array())))).toBe(true);
    expect(Result.isFailure(yield* Effect.result(connection.write(new Uint8Array(65537))))).toBe(
      true,
    );
  }),
);

it.effect("TRANSPORT-07: failure unwinds acquisition and a retired handle cannot reopen", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    yield* Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          yield* service.open(yield* config);
          return yield* Effect.fail(new TransportError({ stage: "read", reason: "io" }));
        }),
      ),
    );
    expect(yield* fixture.observations).toEqual({ acquired: 1, closed: 1, acceptedBytes: 0 });
    expect(yield* Effect.result(service.open(yield* config))).toEqual(
      Result.fail(new TransportError({ stage: "open", reason: "unavailable" })),
    );
  }),
);

it.effect("TRANSPORT-08: accepted capture limits fail without releasing an incomplete write", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const service = yield* Transport.pipe(Effect.provide(fixture.layer));
    const connection = yield* service.open(yield* config);
    const writer = yield* Effect.forkChild(connection.write(new Uint8Array([1, 2])));
    const attempt = yield* fixture.nextWrite;
    expect(yield* Effect.result(attempt.accept(3))).toEqual(
      Result.fail(new TransportError({ stage: "write", reason: "limit" })),
    );
    expect(writer.pollUnsafe()).toBeUndefined();
    expect((yield* fixture.observations).acceptedBytes).toBe(0);
    yield* attempt.accept(2);
    yield* Fiber.join(writer);
  }),
);
