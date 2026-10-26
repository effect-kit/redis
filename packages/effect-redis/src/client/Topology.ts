import { Effect, Layer, Schema } from "effect";
import type { Scope } from "effect";

import { prepareNative } from "#/client/Input";
import type { NativeClusterInput, NativeServices, NativeSettings } from "#/client/Input";
import { RedisCluster } from "#/cluster/RedisCluster";
import { TlsOptions } from "#/config/Endpoint";
import { RedisCredentials } from "#/credentials/Manager";
import { makeNativeCredentials } from "#/credentials/Native";
import { decodeCredentialInput, provider } from "#/credentials/Provider";
import { RedisSentinelCredentials, sentinelCredentialService } from "#/credentials/Sentinel";
import { RedisConfigError } from "#/errors/RedisConfigError";
import type { RedisConfigInput } from "#/RedisConfig";
import { decodeSentinelConfig } from "#/sentinel/Config";
import type { SentinelOptions } from "#/sentinel/Options";
import { RedisSentinel } from "#/sentinel/RedisSentinel";

export const clusterLayer = <R = never>({ cluster: options, ...input }: NativeClusterInput<R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const prepared = yield* prepareNative(input, "cluster");
      const identity = yield* makeNativeCredentials(
        prepared.source,
        prepared.credentialLifetime,
        undefined,
        prepared,
      );
      const cluster = RedisCluster.layer<Scope.Scope>(prepared.config, {
        ...options,
        connection: { ...prepared.connection, credentials: identity.credentials },
        ...(prepared.sessions === undefined ? {} : { sessions: prepared.sessions }),
      });
      return Layer.mergeAll(cluster, Layer.succeed(RedisCredentials, identity.identity)).pipe(
        Layer.provide(identity.infrastructure),
      );
    }),
  );

export interface NativeSentinelInput<RData = never, RControl = RData> {
  readonly serviceName: string;
  readonly sentinels: readonly [RedisConfigInput, ...RedisConfigInput[]];
  readonly data?: NativeSettings;
  readonly credentials?: NativeServices<RData>["credentials"];
  readonly credentialLifetime?: NativeServices<RData>["credentialLifetime"];
  readonly sentinelCredentials?: NativeServices<RControl>["credentials"];
  readonly sentinelCredentialLifetime?: NativeServices<RControl>["credentialLifetime"];
  readonly connection?: NativeServices<RData>["connection"];
  readonly sessions?: NativeServices<RData>["sessions"];
  readonly sentinel?: Omit<SentinelOptions<RData, RControl>, "connection" | "sessions">;
  readonly profile?: NativeServices<RData>["profile"];
  readonly network?: NativeServices<RData>["network"];
}

export const sentinelLayer = <RData = never, RControl = RData>(
  input: NativeSentinelInput<RData, RControl>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const dataTls =
        input.sentinel?.dataTls === undefined
          ? undefined
          : yield* Schema.encodeEffect(TlsOptions)(input.sentinel.dataTls).pipe(
              Effect.mapError(
                () =>
                  new RedisConfigError({
                    field: "sentinel.dataTls",
                    reason: "Invalid data TLS configuration",
                  }),
              ),
            );
      const prepared = yield* prepareNative(
        {
          ...input.data,
          endpoint: {
            host: "sentinel.invalid",
            ...(dataTls === undefined ? {} : { tls: dataTls }),
          },
          ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
          ...(input.credentialLifetime === undefined
            ? {}
            : { credentialLifetime: input.credentialLifetime }),
          ...(input.connection === undefined ? {} : { connection: input.connection }),
          ...(input.profile === undefined ? {} : { profile: input.profile }),
          ...(input.network === undefined ? {} : { network: input.network }),
        },
        "sentinel",
      );
      const config = yield* decodeSentinelConfig({
        serviceName: input.serviceName,
        sentinels: input.sentinels,
      });

      const identity = yield* makeNativeCredentials(
        prepared.source,
        prepared.credentialLifetime,
        undefined,
        prepared,
      );
      const legacyControl = input.sentinel?.sentinelConnection?.credentials;
      if (legacyControl !== undefined && input.sentinelCredentials !== undefined)
        return yield* new RedisConfigError({
          field: "sentinel.credentials",
          reason: "Choose one control credential source",
        });
      const controlInput = input.sentinelCredentials ?? legacyControl;
      if (
        controlInput !== undefined &&
        config.sentinels.some((endpoint) => endpoint.credentials !== undefined)
      )
        return yield* new RedisConfigError({
          field: "sentinel.credentials",
          reason: "Choose endpoint credentials or a control credential source",
        });
      if (controlInput === undefined && input.sentinelCredentialLifetime !== undefined)
        return yield* new RedisConfigError({
          field: "sentinel.credentials",
          reason: "A managed control lifetime requires a control credential source",
        });
      const controlSource = yield* decodeCredentialInput<RControl>(controlInput);
      const control =
        controlInput === undefined
          ? undefined
          : yield* makeNativeCredentials(
              controlSource.source ?? provider(Effect.succeed(controlSource.fixed)),
              input.sentinelCredentialLifetime,
              identity.bindings,
              { plane: "sentinel" },
            );

      const sentinel = RedisSentinel.layer<Scope.Scope, RControl | Scope.Scope>(
        { ...config, data: prepared.config },
        {
          ...input.sentinel,
          connection: { ...prepared.connection, credentials: identity.credentials },
          ...(control === undefined
            ? {}
            : {
                sentinelConnection: {
                  ...input.sentinel?.sentinelConnection,
                  credentials: control.credentials,
                },
              }),
          ...(input.sessions === undefined ? {} : { sessions: input.sessions }),
        },
      );
      return Layer.mergeAll(
        sentinel,
        Layer.succeed(RedisCredentials, identity.identity),
        Layer.succeed(
          RedisSentinelCredentials,
          sentinelCredentialService(identity.bindings, control?.identity),
        ),
      ).pipe(Layer.provide(identity.infrastructure));
    }),
  );
