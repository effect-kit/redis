import { expect } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { RedisConnection, ConnectionSnapshot } from "../../../src/connection/Connection.js";
import { makeConnection } from "../../../src/connection/Connection.js";
import type { ConnectionOptions } from "../../../src/connection/Options.js";
import { TransportError } from "../../../src/errors/TransportError.js";
import { encodeCommand } from "../../../src/protocol/encode.js";
import type { RedisCommand } from "../../../src/protocol/encode.js";
import { decodeRedisConfig } from "../../../src/RedisConfig.js";
import { Transport } from "../../../src/transport/Transport.js";
import { makeControlledTransport } from "../transport/ControlledTransport.js";

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
