import { Effect, Schedule } from "effect";

import { connect, layer } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { makeRedisSessions } from "#/sessions/RedisSessions";
import { exchange } from "#test/support/networking/Exchange";
import { requireImage } from "#test/support/servers/Containers";
import { allocateServer } from "#test/support/servers/DockerServer";
import { FixtureError } from "#test/support/servers/FixtureError";
import { fixtureNetwork } from "#test/support/servers/Network";
import type { ServerTarget } from "#test/support/servers/Targets";

export const replicatedBackend = Effect.fnUntraced(function* (
  target: ServerTarget,
  protocol: string,
) {
  yield* requireImage(target.reference);
  const network = yield* fixtureNetwork;
  const aof = ["appendonly yes", "appendfsync always", "repl-diskless-sync-delay 0"];
  const primary = yield* (yield* allocateServer(target, {
    network,
    networkAlias: "primary",
    extraConfig: aof,
  })).start;
  const replica = yield* (yield* allocateServer(target, {
    network,
    networkAlias: "replica",
    extraConfig: [...aof, "replicaof primary 6379"],
  })).start;
  const replicaOracle = yield* connect(
    yield* decodeRedisConfig({
      endpoint: { host: "127.0.0.1", port: replica.port },
      protocol: "resp2",
    }),
  );

  yield* Effect.gen(function* () {
    const reply = yield* exchange(replicaOracle, ["INFO", "replication"]);
    if (reply._tag !== "BlobString") return yield* new FixtureError({ stage: "replica-info" });
    const info = new TextDecoder().decode(reply.value);
    if (!info.includes("master_link_status:up") || !info.includes("master_sync_in_progress:0"))
      return yield* new FixtureError({ stage: "replica-not-ready" });
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced(25), times: 200 }),
    Effect.timeoutOrElse({
      duration: 10_000,
      orElse: () => Effect.fail(new FixtureError({ stage: "replication-readiness" })),
    }),
  );

  const config = yield* decodeRedisConfig({
    endpoint: { host: "127.0.0.1", port: primary.port },
    protocol,
  });
  const sessions = yield* makeRedisSessions(config).pipe(Effect.provide(layer));

  return { primary, replica, replicaOracle, sessions };
});
