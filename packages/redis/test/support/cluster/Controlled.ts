import { Effect, Fiber, Layer } from "effect";

import type { ClusterOptions } from "#/cluster/Options";
import { makeRedisCluster } from "#/cluster/RedisCluster";
import { TransportError } from "#/errors/TransportError";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import { sent } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

export const slotReply = (host = "a", node = "node-a") =>
  `*1\r\n*3\r\n:0\r\n:16383\r\n*3\r\n$${host.length}\r\n${host}\r\n:6379\r\n$${node.length}\r\n${node}\r\n`;

/** Mechanical sockets only: each test supplies every expected frame and every server reply. */
export const clusterControlled = Effect.fnUntraced(function* (
  options: ClusterOptions = {},
  cleanupDefectHost?: string,
) {
  const seed = yield* makeControlledTransport();
  const a = yield* makeControlledTransport();
  const b = yield* makeControlledTransport();
  const fixtures = { seed, a, b };
  const services = new Map(
    yield* Effect.forEach(Object.entries(fixtures), ([host, fixture]) =>
      Transport.pipe(
        Effect.provide(fixture.layer),
        Effect.map((transport) => [host, transport] as const),
      ),
    ),
  );
  const layer = Layer.succeed(Transport, {
    open: (config) =>
      Effect.suspend(() => {
        const service =
          config.endpoint._tag === "Tcp" ? services.get(config.endpoint.host) : undefined;
        if (service === undefined)
          return Effect.fail(new TransportError({ stage: "open", reason: "unavailable" }));
        return Effect.gen(function* () {
          const physical = yield* service.open(config);
          if (config.endpoint._tag === "Tcp" && config.endpoint.host === cleanupDefectHost)
            yield* Effect.addFinalizer(() => Effect.die("cluster-controlled-cleanup"));
          return physical;
        });
      }),
  });
  const config = yield* decodeRedisConfig({
    endpoint: { host: "seed" },
    protocol: "resp2",
    commandTimeoutMillis: 1000,
  });
  const opening = yield* Effect.forkChild(
    makeRedisCluster(config, {
      discovery: "slots",
      sessions: { maxSessionConnections: 1, maxBlockingConnections: 1 },
      ...options,
    }).pipe(Effect.provide(layer)),
  );
  yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply());
  const client = yield* Fiber.join(opening);

  return { ...fixtures, client, config, layer };
});
