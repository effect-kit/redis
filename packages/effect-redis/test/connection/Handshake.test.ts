import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";

import { makeConnection } from "#/connection/Connection";
import { decodeRedisConfig } from "#/RedisConfig";
import { bytes, sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

const hello = "%2\r\n+server\r\n+redis\r\n+proto\r\n:3\r\n";

it.effect(
  "HANDSHAKE-01: AUTH, RESP3, naming and database complete in order before acquisition returns",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        credentials: { username: "fixture", password: "synthetic" },
        clientName: "fixture-client",
        database: 2,
      });

      const opening = yield* Effect.forkChild(
        makeConnection(config).pipe(Effect.provide(fixture.layer)),
      );

      yield* sent(fixture, ["AUTH", "fixture", "synthetic"], "+OK\r\n");
      expect(opening.pollUnsafe()).toBeUndefined();
      yield* sent(fixture, ["HELLO", "3"], hello);
      yield* sent(fixture, ["CLIENT", "SETNAME", "fixture-client"], "+OK\r\n");
      const select = yield* sent(fixture, ["SELECT", "2"]);
      expect(opening.pollUnsafe()).toBeUndefined();
      expect(select.bytes.length).toBeGreaterThan(0);
      yield* fixture.receive(bytes("+OK\r\n"));

      const connection = yield* Fiber.join(opening);

      expect(yield* connection.snapshot).toMatchObject({
        state: "ready",
        protocol: "resp3",
        generation: 1,
      });
    }),
);

it.effect.each([
  "-ERR unknown command 'HELLO', with args beginning with: '3'\r\n",
  "-NOPROTO unsupported protocol version\r\n",
])("HANDSHAKE-02: auto falls back only on reviewed unsupported response %#", (reply) =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });

    const opening = yield* Effect.forkChild(
      makeConnection(config).pipe(Effect.provide(fixture.layer)),
    );

    yield* sent(fixture, ["HELLO", "3"], reply);
    expect(yield* (yield* Fiber.join(opening)).snapshot).toMatchObject({
      state: "ready",
      protocol: "resp2",
    });
  }),
);

it.effect.each([
  "-NOPERM no permission\r\n",
  "-NOAUTH synthetic-secret\r\n",
  "+OK\r\n",
  "%1\r\n+proto\r\n:2\r\n",
  "-ERR unknown command 'OTHER'\r\n",
])("HANDSHAKE-03: rejects auth/ACL/invalid HELLO without fallback %#", (reply) =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });

    const opening = yield* Effect.forkChild(
      Effect.result(makeConnection(config).pipe(Effect.provide(fixture.layer))),
    );

    yield* sent(fixture, ["HELLO", "3"], reply);

    const result = yield* Fiber.join(opening);

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "HandshakeError",
      stage: "hello",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("HANDSHAKE-04: strict RESP3 rejects unsupported; auth failure never sends HELLO", () =>
  Effect.gen(function* () {
    for (const auth of [true, false]) {
      const fixture = yield* makeControlledTransport();
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp3",
        ...(auth ? { credentials: { password: "synthetic" } } : {}),
      });

      const opening = yield* Effect.forkChild(
        Effect.result(makeConnection(config).pipe(Effect.provide(fixture.layer))),
      );
      yield* sent(
        fixture,
        auth ? ["AUTH", "synthetic"] : ["HELLO", "3"],
        auth ? "-WRONGPASS synthetic\r\n" : "-NOPROTO unsupported protocol version\r\n",
      );
      const result = yield* Fiber.join(opening);
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "HandshakeError",
        stage: auth ? "auth" : "hello",
      });
      expect(yield* fixture.written).toHaveLength(1);
    }
  }),
);

it.effect("HANDSHAKE-05: stalled bootstrap times out and closes the transport", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      connectTimeoutMillis: 100,
    });

    const opening = yield* Effect.forkChild(
      Effect.result(makeConnection(config).pipe(Effect.provide(fixture.layer))),
    );

    yield* sent(fixture, ["HELLO", "3"]);

    yield* TestClock.adjust(100);

    const result = yield* Fiber.join(opening);

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "HandshakeError",
      stage: "timeout",
    });
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);

it.effect("HANDSHAKE-06: malformed negotiation is a protocol failure, never fallback", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();

    const opening = yield* Effect.forkChild(
      Effect.result(
        makeConnection(yield* decodeRedisConfig({ endpoint: { host: "localhost" } })).pipe(
          Effect.provide(fixture.layer),
        ),
      ),
    );

    yield* sent(fixture, ["HELLO", "3"], ":not-an-integer\r\n");

    const result = yield* Fiber.join(opening);

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "ProtocolError",
      stage: "decode",
    });
  }),
);

it.effect("HANDSHAKE-07: an Effect credential source authenticates before negotiation", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const credentials = Effect.succeed({ password: Redacted.make("synthetic") });

    const opening = yield* Effect.forkChild(
      makeConnection(config, { credentials }).pipe(Effect.provide(fixture.layer)),
    );

    yield* sent(fixture, ["AUTH", "synthetic"], "+OK\r\n");

    yield* sent(fixture, ["HELLO", "3"], hello);
    expect(yield* (yield* Fiber.join(opening)).snapshot).toMatchObject({ protocol: "resp3" });
  }),
);

it.effect("HANDSHAKE-13: canceling acquisition during negotiation awaits physical cleanup", () =>
  Effect.gen(function* () {
    const fixture = yield* makeControlledTransport();
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });

    const opening = yield* Effect.forkChild(
      makeConnection(config).pipe(Effect.provide(fixture.layer)),
    );

    yield* sent(fixture, ["HELLO", "3"]);
    yield* Fiber.interrupt(opening);
    expect((yield* fixture.observations).closed).toBe(1);
  }),
);
