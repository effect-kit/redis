import { Effect, Layer } from "effect";

import { RedisAdmin } from "#/admin/RedisAdmin";
import { prepareNative } from "#/client/Input";
import type { NativeClientInput } from "#/client/Input";
import { CommandExecutor } from "#/command/Executor";
import { Connection } from "#/connection/Connection";
import { RedisCredentials } from "#/credentials/Manager";
import { makeNativeCredentials } from "#/credentials/Native";
import { Redis } from "#/Redis";
import { RedisScripts } from "#/scripting/RedisScripts";
import { RedisSessions } from "#/sessions/RedisSessions";
import { RedisStreams } from "#/streams/RedisStreams";
import { RedisPubSub } from "#/subscriptions/RedisPubSub";

/** Reuse Layer values across branches so helpers share one ordinary engine and lease pool. */
export const standaloneLayer = <R = never>(input: NativeClientInput<R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const prepared = yield* prepareNative(input);
      const { config } = prepared;
      const identity = yield* makeNativeCredentials(
        prepared.source,
        prepared.credentialLifetime,
        undefined,
        prepared,
      );
      const connection = { ...prepared.connection, credentials: identity.credentials };
      const executor = CommandExecutor.layer.pipe(
        Layer.provide(Connection.layer(config, connection)),
      );
      const ordinary = Redis.layer.pipe(Layer.provideMerge(executor));
      const sessions = RedisSessions.layer(config, {
        ...prepared.sessions,
        connection,
      });
      const core = Layer.mergeAll(ordinary, sessions);

      return Layer.mergeAll(
        core,
        RedisStreams.layer.pipe(Layer.provide(core)),
        RedisScripts.layer(prepared.scripts).pipe(Layer.provide(sessions)),
        RedisAdmin.layer.pipe(Layer.provide(sessions)),
        RedisPubSub.layer(config, {
          ...prepared.subscriptions,
          ...(connection.credentials === undefined ? {} : { credentials: connection.credentials }),
        }),
        Layer.succeed(RedisCredentials, identity.identity),
      ).pipe(Layer.provide(identity.infrastructure));
    }),
  );
