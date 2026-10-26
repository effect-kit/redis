import { Effect, Layer } from "effect";

import {
  CommandExecutor,
  Connection,
  Redis,
  RedisSessions,
  decodeRedisConfig,
} from "@effect-kit/redis";

import { nativeInput } from "#test/support/client/Input";
import type { Input } from "#test/support/hardening/Contract";

export const nativeAdapter = async () =>
  typeof Bun === "undefined"
    ? await import("@effect-kit/redis/node")
    : await import("@effect-kit/redis/bun");

/** Keep the same public core/pool implementation while exposing the native queue-wait snapshot. */
export const benchmarkLayer = (input: Input, adapter: Awaited<ReturnType<typeof nativeAdapter>>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig(input.config);
      const connection = Connection.layer(config);
      const executor = CommandExecutor.layer.pipe(Layer.provideMerge(connection));
      return Layer.mergeAll(
        Redis.layer.pipe(Layer.provideMerge(executor)),
        RedisSessions.layer(config),
      ).pipe(Layer.provide(adapter.layer));
    }),
  );

export const readyLayer = (input: Input, adapter: Awaited<ReturnType<typeof nativeAdapter>>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig(input.config);
      return "RedisNode" in adapter
        ? adapter.RedisNode.layer(nativeInput(config))
        : adapter.RedisBun.layer(nativeInput(config));
    }),
  );
