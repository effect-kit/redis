import { expect } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { RedisConnection, ConnectionSnapshot } from "#/connection/Connection";
import { makeConnection } from "#/connection/Connection";
import type { ConnectionOptions } from "#/connection/Options";
import { TransportError } from "#/errors/TransportError";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

export const bytes = (text: string) => new TextEncoder().encode(text);
export const controlled = Effect.fnUntraced(function* (
  input: Record<string, unknown> = {},
  options?: ConnectionOptions,
) {
  const fixture = yield* makeControlledTransport();
  const config = yield* decodeRedisConfig({
    endpoint: { host: "localhost" },
    protocol: "resp2",
    ...input,
  });
  const connection = yield* makeConnection(config, { reconnectAttempts: 1, ...options }).pipe(
    Effect.provide(fixture.layer),
  );
  return { fixture, config, connection };
});
export const sent = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof makeControlledTransport>>,
  command: RedisCommand,
  reply?: string,
) {
  const attempt = yield* fixture.nextWrite;
  expect(attempt.bytes).toEqual(yield* Effect.fromResult(encodeCommand(command)));
  yield* attempt.accept(attempt.bytes.length);
  if (reply !== undefined) yield* fixture.receive(bytes(reply));
  return attempt;
});
export const reconnecting = Effect.fnUntraced(function* () {
  const fixtures = yield* Effect.forEach([0, 1, 2], () => makeControlledTransport());
  const services = yield* Effect.forEach(fixtures, (fixture) =>
    Transport.pipe(Effect.provide(fixture.layer)),
  );
  let opens = 0;
  const layer = Layer.succeed(Transport, {
    open: (config) =>
      Effect.suspend(() => {
        const service = services[opens++];
        return service === undefined
          ? Effect.fail(new TransportError({ stage: "open", reason: "unavailable" }))
          : service.open(config);
      }),
  });
  return { fixtures, layer, opens: () => opens };
});

export const waitForSnapshot = Effect.fnUntraced(function* (
  connection: RedisConnection,
  predicate: (snapshot: ConnectionSnapshot) => boolean,
) {
  while (true) {
    const snapshot = yield* connection.snapshot;
    if (predicate(snapshot)) return snapshot;
    yield* Effect.yieldNow;
  }
});
