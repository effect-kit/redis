import { Effect, Exit, Layer, Redacted } from "effect";

import { connect as nativeConnect } from "bun";

import { TransportError } from "#/errors/TransportError";
import type { RedisConfig } from "#/RedisConfig";
import { makePhysical } from "#/transport/bun/Connection";
import { Transport } from "#/transport/Transport";

/** Acquires a native Bun socket. Readiness includes TLS authorization when configured. */
export const connect = Effect.fnUntraced(function* (config: RedisConfig) {
  const endpoint = config.endpoint;
  const tls = endpoint._tag === "Tcp" ? endpoint.tls : undefined;

  const physical = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const acquiring = makePhysical(
        config.limits.maxInFlightBytes,
        config.limits.maxBufferedBytes,
        tls !== undefined,
        tls?.rejectUnauthorized && endpoint._tag === "Tcp"
          ? (tls.serverName ?? endpoint.host)
          : undefined,
      );

      acquiring.start(() => {
        if (endpoint._tag === "Unix")
          return nativeConnect({ unix: endpoint.path, socket: acquiring.handlers });

        return nativeConnect({
          hostname: endpoint.host,
          port: endpoint.port,
          ...(tls === undefined
            ? {}
            : {
                tls: {
                  rejectUnauthorized: tls.rejectUnauthorized,
                  ...(tls.serverName === undefined ? {} : { serverName: tls.serverName }),
                  ...(tls.ca === undefined ? {} : { ca: Redacted.value(tls.ca) }),
                  ...(tls.certificate === undefined
                    ? {}
                    : { cert: Redacted.value(tls.certificate) }),
                  ...(tls.privateKey === undefined ? {} : { key: Redacted.value(tls.privateKey) }),
                },
              }),
          socket: acquiring.handlers,
        });
      });

      return acquiring;
    }),
    (owned) => owned.close,
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

export const layer = Layer.succeed(Transport, { open: connect });
