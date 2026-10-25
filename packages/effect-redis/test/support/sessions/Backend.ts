import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import { makeExecutor } from "#/command/Executor";
import { makeConnection } from "#/connection/Connection";
import { connect, layer } from "#/node";
import { makeRedis } from "#/Redis";
import { decodeRedisConfig } from "#/RedisConfig";
import { makeRedisSessions } from "#/sessions/RedisSessions";
import { allocateServer } from "#test/support/servers/DockerServer";
import type { ServerTarget } from "#test/support/servers/Targets";

export const sessionBackend = Effect.fnUntraced(function* (
  target: ServerTarget,
  protocol: string,
  extraConfig?: ReadonlyArray<string>,
) {
  const server = yield* (yield* allocateServer(
    target,
    extraConfig === undefined ? undefined : { extraConfig },
  )).start;
  const config = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: server.port },
    protocol,
  });
  const sessions = yield* makeRedisSessions(config, {
    maxSessionConnections: 1,
    maxBlockingConnections: 1,
  }).pipe(Effect.provide(layer));
  const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
  const oracle = yield* connect(config);

  return {
    server,
    config,
    sessions,
    connection,
    oracle,
    redis: makeRedis(makeExecutor(connection)),
    prefix: `effect-redis:session:${randomUUID()}`,
  };
});
