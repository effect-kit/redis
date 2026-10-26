import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import { makeExecutor } from "#/command/Executor";
import { pairs, simpleText } from "#/command/reply/Data";
import { makeConnection } from "#/connection/Connection";
import { connect, layer } from "#/node";
import { makeRedis } from "#/Redis";
import { decodeRedisConfig } from "#/RedisConfig";
import { moduleFixtures } from "#test/support/modules/Manifest";
import { exchange } from "#test/support/networking/Exchange";
import { allocateServer } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
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
) {
  const target = moduleTarget(fixture);
  const server = yield* (yield* allocateServer(target, {
    extraConfig: fixture.loadModules.map((path) => `loadmodule ${path}`),
  })).start;
  const config = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: server.port },
    protocol,
  });
  const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
  const oracle = yield* connect(config);

  const reply = yield* exchange(oracle, ["MODULE", "LIST"]);
  if (reply._tag !== "Array") return yield* new FixtureError({ stage: "module-list" });
  const observed: Record<string, string> = {};
  for (const entry of reply.values) {
    const fields = yield* pairs(simpleText, Effect.succeed)(entry);
    const name = fields.find(([key]) => key === "name")?.[1];
    const version = fields.find(([key]) => key === "ver")?.[1];
    if (name === undefined || version?._tag !== "Integer")
      return yield* new FixtureError({ stage: "module-identity" });
    observed[yield* simpleText(name)] = String(version.value);
  }
  if (
    JSON.stringify(Object.entries(observed).toSorted()) !==
    JSON.stringify(Object.entries(fixture.modules).toSorted())
  )
    return yield* new FixtureError({ stage: "module-version" });

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
