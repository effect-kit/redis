import { Config, Context, Effect, Redacted } from "effect";
import type { Layer } from "effect";

import { RedisBun } from "#/bun";
import { Commands, Redis, RedisSessions, RedisStreams } from "#/index";
import { RedisNode } from "#/node";
import { RedisUpstash } from "#/upstash";

class Identity extends Context.Service<Identity, { readonly password: string }>()(
  "test/layers/Identity",
) {}

const node = RedisNode.layer({ url: "redis://localhost" });
const bun = RedisBun.layerConfig(Config.succeed({ url: "redis://localhost" }));
const http = RedisUpstash.layer({ url: "https://example.test", token: Redacted.make("fixture") });
const httpConfig = RedisUpstash.layerConfig(
  Config.all({ url: Config.String("HTTP_URL"), token: Config.Redacted("HTTP_TOKEN") }),
);
const cluster = RedisNode.layerCluster({
  url: "redis://localhost",
  cluster: { seeds: [{ host: "other", port: 6379 }] },
});
const sentinel = RedisBun.layerSentinel({
  serviceName: "primary",
  sentinels: [{ endpoint: { host: "localhost" } }],
});
const authenticated = RedisNode.layer({
  url: "rediss://localhost",
  credentials: Identity.pipe(Effect.map(({ password }) => ({ password: Redacted.make(password) }))),
});
const batch = Redis.pipe(Effect.flatMap((redis) => redis.pipeline([Commands.incr("key")])));
const nativeProgram = Effect.all([Redis, RedisSessions, RedisStreams]);
const nodeBatch = batch.pipe(Effect.provide(node));
const httpBatch = batch.pipe(Effect.provide(http));

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type LayerContracts = [
  Assert<Equal<Layer.Services<typeof node>, never>>,
  Assert<Equal<Layer.Services<typeof bun>, never>>,
  Assert<Equal<Layer.Services<typeof http>, never>>,
  Assert<Equal<Layer.Services<typeof httpConfig>, never>>,
  Assert<Equal<Layer.Services<typeof cluster>, never>>,
  Assert<Equal<Layer.Services<typeof sentinel>, never>>,
  Assert<Equal<Layer.Services<typeof authenticated>, Identity>>,
  Assert<Equal<Effect.Services<typeof nodeBatch>, never>>,
  Assert<Equal<Effect.Services<typeof httpBatch>, never>>,
];

Effect.runPromise(batch.pipe(Effect.provide(node)));
Effect.runPromise(batch.pipe(Effect.provide(http)));
Effect.runPromise(nativeProgram.pipe(Effect.provide(bun)));

// @ts-expect-error HTTP does not provide physical session capabilities.
Effect.runPromise(nativeProgram.pipe(Effect.provide(http)));

// @ts-expect-error Identity requirements remain required at Layer construction.
Effect.runPromise(Redis.pipe(Effect.provide(authenticated)));

// @ts-expect-error Choose one address representation.
RedisNode.layer({ url: "redis://localhost", endpoint: { host: "localhost" } });

// @ts-expect-error Preset credential values must be redacted.
RedisNode.layer({ url: "redis://localhost", credentials: { password: "plain" } });
