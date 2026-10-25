import { randomUUID } from "node:crypto";

import { expect } from "@effect/vitest";
import { Effect } from "effect";

import { makeExecutor } from "#/command/Executor";
import { makeConnection } from "#/connection/Connection";
import { connect, layer } from "#/node";
import { makeRedis } from "#/Redis";
import { decodeRedisConfig } from "#/RedisConfig";
import { exchange } from "#test/support/networking/Exchange";
import { dockerServer } from "#test/support/servers/DockerServer";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";
import type { ServerTarget } from "#test/support/servers/Targets";

export const primaryCases = serverTargets
  .filter(
    (target) =>
      ["redis", "valkey"].includes(target.product) &&
      (selectedEngine === "all" || selectedEngine === target.product),
  )
  .flatMap((target) => ["resp2", "resp3"].map((protocol) => ({ target, protocol })));

export const backend = Effect.fnUntraced(function* (target: ServerTarget, protocol: string) {
  const server = yield* dockerServer(target);
  const endpoint = { host: "127.0.0.1", port: server.port };
  const connection = yield* makeConnection(yield* decodeRedisConfig({ endpoint, protocol })).pipe(
    Effect.provide(layer),
  );
  const oracle = yield* connect(yield* decodeRedisConfig({ endpoint }));

  return {
    redis: makeRedis(makeExecutor(connection)),
    oracle,
    prefix: `effect-redis:core:${randomUUID()}`,
    server,
  };
});

/** Compare our pinned product/version, never an engine's advertised compatibility banner. */
export const atLeast = (version: string, baseline: string) => {
  const current = version.split(".").map(Number);
  const required = baseline.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (current[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
};

export const absent = Effect.fnUntraced(function* (
  oracle: Effect.Success<ReturnType<typeof backend>>["oracle"],
  name: string,
) {
  const reply = yield* exchange(oracle, ["COMMAND", "INFO", name]);

  expect(reply, name).toMatchObject({ _tag: "Array", values: [{ _tag: "Null" }] });
});
