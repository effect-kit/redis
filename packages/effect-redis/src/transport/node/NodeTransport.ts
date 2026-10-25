import { createConnection, isIP } from "node:net";
import { connect as connectTls, createSecureContext } from "node:tls";

import { Effect, Exit, Layer, Redacted } from "effect";

import { TransportError } from "#/errors/TransportError";
import type { RedisConfig } from "#/RedisConfig";
import { makeConnection } from "#/transport/node/Connection";
import { Transport } from "#/transport/Transport";

/** Acquires one TCP/TLS/Unix connection. Config must first pass decodeRedisConfig. */
export const connect = Effect.fnUntraced(function* (config: RedisConfig) {
  const physical = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const endpoint = config.endpoint;
        if (endpoint._tag === "Unix")
          return makeConnection(
            createConnection({ path: endpoint.path }),
            "connect",
            config.limits.maxInFlightBytes,
          );
        if (endpoint.tls === undefined)
          return makeConnection(
            createConnection({ host: endpoint.host, port: endpoint.port }),
            "connect",
            config.limits.maxInFlightBytes,
          );
        const tls = endpoint.tls;
        const servername =
          tls.serverName ?? (isIP(endpoint.host) === 0 ? endpoint.host : undefined);
        const secureContext = createSecureContext({
          ...(tls.ca === undefined ? {} : { ca: Redacted.value(tls.ca) }),
          ...(tls.certificate === undefined ? {} : { cert: Redacted.value(tls.certificate) }),
          ...(tls.privateKey === undefined ? {} : { key: Redacted.value(tls.privateKey) }),
        });
        const socket = connectTls({
          host: endpoint.host,
          port: endpoint.port,
          ...(servername === undefined ? {} : { servername }),
          rejectUnauthorized: tls.rejectUnauthorized,
          secureContext,
        });
        return makeConnection(socket, "secureConnect", config.limits.maxInFlightBytes);
      },
      catch: (cause) =>
        new TransportError({ stage: "open", reason: "io", cause: Redacted.make(cause) }),
    }),
    (connection) => connection.close,
  );
  yield* physical.ready.pipe(
    Effect.timeoutOrElse({
      duration: config.connectTimeoutMillis,
      orElse: () => Effect.fail(new TransportError({ stage: "open", reason: "timeout" })),
    }),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? physical.close : Effect.void)),
  );
  return physical.connection;
});

/** Transport acquisition is scoped per open; the stateless Layer opens no sockets. */
export const layer = Layer.succeed(Transport, { open: connect });
