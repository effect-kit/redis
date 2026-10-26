import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import { makeExecutor } from "#/command/Executor";
import { makeConnection } from "#/connection/Connection";
import { connect, layer } from "#/node";
import { makeRedis } from "#/Redis";
import { decodeRedisConfig } from "#/RedisConfig";
import { moduleIdentity } from "#test/support/modules/Identity";
import { moduleFixtures } from "#test/support/modules/Manifest";
import { exchange } from "#test/support/networking/Exchange";
import { allocateServer } from "#test/support/servers/DockerServer";
import { selectedEngine } from "#test/support/servers/Targets";

export const moduleCases = moduleFixtures
  .filter((fixture) => selectedEngine === "all" || selectedEngine === fixture.engine)
  .flatMap((fixture) => ["resp2", "resp3"].map((protocol) => ({ fixture, protocol })));

export const moduleTarget = (fixture: (typeof moduleFixtures)[number]) => ({
  fixture: fixture.id,
  product: fixture.engine,
  version: fixture.serverVersion,
  image: fixture.image,
  digest: fixture.digest,
  reference: `${fixture.image}@${fixture.digest}`,
  modules: fixture.modules,
});

export const moduleBackend = Effect.fnUntraced(function* (
  fixture: (typeof moduleFixtures)[number],
  protocol: string,
  options: { readonly aof?: boolean } = {},
) {
  const target = moduleTarget(fixture);
  const server = yield* (yield* allocateServer(target, {
    extraConfig: [
      ...fixture.loadModules.map((path) => `loadmodule ${path}`),
      ...(options.aof ? ["appendonly yes", "aof-use-rdb-preamble no", "dir /fixture"] : []),
    ],
    ...(options.aof ? { writableConfiguration: true } : {}),
  })).start;
  const config = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: server.port },
    protocol,
  });
  const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
  const oracle = yield* connect(config);

  const reply = yield* exchange(oracle, ["MODULE", "LIST"]);
  const observed = yield* moduleIdentity(reply, fixture.modules);

  return {
    redis: makeRedis(makeExecutor(connection)),
    oracle,
    connection,
    config,
    server,
    prefix: `effect-redis:module:${randomUUID()}`,
    observed,
  };
});
