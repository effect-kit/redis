import { Effect, Layer } from "effect";

import { prepareNative } from "#/client/Input";
import type { NativeClusterInput, NativeServices, NativeSettings } from "#/client/Input";
import { RedisCluster } from "#/cluster/RedisCluster";
import type { RedisConfigInput } from "#/RedisConfig";
import { decodeSentinelConfig } from "#/sentinel/Config";
import type { SentinelOptions } from "#/sentinel/Options";
import { RedisSentinel } from "#/sentinel/RedisSentinel";

export const clusterLayer = <R = never>({ cluster, ...input }: NativeClusterInput<R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const prepared = yield* prepareNative(input);
      return RedisCluster.layer(prepared.config, {
        ...cluster,
        connection: prepared.connection,
        ...(prepared.sessions === undefined ? {} : { sessions: prepared.sessions }),
      });
    }),
  );

export interface NativeSentinelInput<RData = never, RControl = RData> {
  readonly serviceName: string;
  readonly sentinels: readonly [RedisConfigInput, ...RedisConfigInput[]];
  readonly data?: NativeSettings;
  readonly credentials?: NativeServices<RData>["credentials"];
  readonly connection?: NativeServices<RData>["connection"];
  readonly sessions?: NativeServices<RData>["sessions"];
  readonly sentinel?: Omit<SentinelOptions<RData, RControl>, "connection" | "sessions">;
}

export const sentinelLayer = <RData = never, RControl = RData>(
  input: NativeSentinelInput<RData, RControl>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const prepared = yield* prepareNative({
        ...input.data,
        endpoint: { host: "sentinel.invalid" },
        ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
        ...(input.connection === undefined ? {} : { connection: input.connection }),
      });
      const config = yield* decodeSentinelConfig({
        serviceName: input.serviceName,
        sentinels: input.sentinels,
      });

      return RedisSentinel.layer(
        { ...config, data: prepared.config },
        {
          ...input.sentinel,
          connection: prepared.connection,
          ...(input.sessions === undefined ? {} : { sessions: input.sessions }),
        },
      );
    }),
  );
