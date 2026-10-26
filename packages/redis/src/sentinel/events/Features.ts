import { Effect, Exit, Option, Scope, Stream } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import { SentinelError } from "#/errors/SentinelError";
import { ServerError } from "#/errors/ServerError";
import type { RedisKey } from "#/keys/RedisKey";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import { sentinelSessionValidation } from "#/sentinel/execution/Validation";
import type { SentinelManager } from "#/sentinel/generation/Manager";
import type { SentinelGeneration } from "#/sentinel/generation/Types";
import type { SentinelOptions } from "#/sentinel/Options";
import type { SubscriptionOptions } from "#/subscriptions/Options";
import { makeRedisPubSub } from "#/subscriptions/RedisPubSub";
import type { SubscribeOptions } from "#/subscriptions/Types";
import type { CacheOptions } from "#/tracking/cache/Cache";
import type { TrackingRuntimeOptions } from "#/tracking/Options";
import { makeRedisTracking } from "#/tracking/RedisTracking";
import type { Transport } from "#/transport/Transport";

const observeTracking = <A, E, RUse>(
  manager: Pick<SentinelManager, "invalidate">,
  generation: SentinelGeneration,
  operation: Effect.Effect<A, E, RUse>,
) =>
  operation.pipe(
    Effect.tapError((error) => {
      // Only native operations reach this boundary; application decoders run below it.
      if (
        (error instanceof ServerError && error.code === "READONLY") ||
        (error instanceof Error &&
          "_tag" in error &&
          ["ConnectionError", "HandshakeError", "TransportError"].includes(String(error._tag)))
      )
        return manager.invalidate(generation);
      return Effect.void;
    }),
  );

const guardEvents = <A, E, RStream>(
  check: Effect.Effect<void, SentinelError>,
  stream: Stream.Stream<A, E, RStream>,
) =>
  Stream.unwrap(check.pipe(Effect.as(stream))).pipe(
    Stream.mapEffect((event) => check.pipe(Effect.as(event))),
    Stream.catchCause((cause) =>
      Stream.fromEffect(check.pipe(Effect.andThen(Effect.failCause(cause)))),
    ),
  );

/** Event cohorts stay bound to one published deployment; topology changes require explicit reacquisition. */
export const makeSentinelEvents = <RData, RSentinel>(
  manager: SentinelManager<RData, RSentinel>,
  options: SentinelOptions<RData, RSentinel>,
) => {
  const open = <A, E>(
    acquire: (
      config: RedisConfig,
      check: Effect.Effect<void, SentinelError>,
      generation: SentinelGeneration,
      scope: Scope.Closeable,
    ) => Effect.Effect<A, E, RData | Transport | Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      const generation = yield* manager.ensure;
      const scope = yield* Scope.fork(yield* Effect.scope);
      let alive = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          alive = false;
        }),
      ).pipe(Scope.provide(scope));
      const close = Scope.close(scope, Exit.void).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit)) manager.poison(exit.cause);
          }),
        ),
      );
      const check = manager.check(generation).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            alive
              ? Effect.void
              : Effect.fail(
                  new SentinelError({
                    reason: "topology-changed",
                    plane: "data",
                    delivery: "unsent",
                  }),
                ),
          ),
        ),
      );
      const node = manager.select(generation, false);

      return yield* manager.observe(generation, close).pipe(
        Scope.provide(scope),
        Effect.andThen(manager.configure(node)),
        Effect.flatMap((config) =>
          acquire(config, check, generation, scope).pipe(
            Effect.provideContext(manager.contextFor(generation, node, scope)),
          ),
        ),
        Effect.tap(() => check),
        Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)),
      );
    });

  const pubsub = (selected: Omit<SubscriptionOptions, "credentials"> = {}) =>
    open((config, check) =>
      Effect.gen(function* () {
        const client = yield* makeRedisPubSub(config, {
          ...selected,
          ...(options.connection?.credentials === undefined
            ? {}
            : { credentials: options.connection.credentials }),
        });

        const subscribe = (
          targets: readonly [RedisArgument, ...RedisArgument[]],
          selection: SubscribeOptions = {},
        ) =>
          check.pipe(
            Effect.andThen(client.subscribe(targets, selection)),
            Effect.map((subscription) => {
              return {
                ...subscription,
                events: guardEvents(check, subscription.events),
                messages: guardEvents(check, subscription.messages),
              };
            }),
          );

        return {
          ...client,
          subscribe,
          psubscribe: (
            targets: readonly [RedisArgument, ...RedisArgument[]],
            selection?: Omit<SubscribeOptions, "mode">,
          ) => subscribe(targets, { ...selection, mode: "pattern" }),
          ssubscribe: (
            targets: readonly [RedisArgument, ...RedisArgument[]],
            selection?: Omit<SubscribeOptions, "mode">,
          ) => subscribe(targets, { ...selection, mode: "shard" }),
        };
      }),
    );

  const tracking = (selected: Omit<TrackingRuntimeOptions, "credentials"> = {}) =>
    open((config, check, generation, scope) =>
      Effect.gen(function* () {
        const client = yield* makeRedisTracking(config, {
          ...selected,
          ...(options.connection?.credentials === undefined
            ? {}
            : { credentials: options.connection.credentials }),
        });
        const validate = sentinelSessionValidation(manager, generation, config.database);

        const executePrepared = <A, E, RD>(intent: PreparedCommand<A, E, RD>) =>
          check.pipe(
            Effect.andThen(validate.command(intent)),
            Effect.andThen(
              observeTracking(
                manager,
                generation,
                client.execute({ prepare: Effect.succeed({ ...intent, decode: Effect.succeed }) }),
              ),
            ),
            Effect.flatMap((reply) => decodeReply(intent, reply)),
          );
        const read = (key: RedisArgument) =>
          check.pipe(Effect.andThen(observeTracking(manager, generation, client.getBytes(key))));

        return {
          ...client,
          executePrepared,
          execute: <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
            command.prepare.pipe(Effect.flatMap(executePrepared)),
          getBytes: read,
          caching: <A, E, RD, RE>(mode: "YES" | "NO", command: Command<A, E, RD, RE>) =>
            command.prepare.pipe(
              Effect.flatMap((intent) =>
                check.pipe(
                  Effect.andThen(validate.command(intent)),
                  Effect.andThen(
                    observeTracking(
                      manager,
                      generation,
                      client.caching(mode, {
                        prepare: Effect.succeed({ ...intent, decode: Effect.succeed }),
                      }),
                    ),
                  ),
                  Effect.flatMap((reply) => decodeReply(intent, reply)),
                ),
              ),
            ),
          restart: check.pipe(Effect.andThen(observeTracking(manager, generation, client.restart))),
          cache: (cacheOptions?: CacheOptions) =>
            check.pipe(
              Effect.andThen(client.cache(cacheOptions).pipe(Scope.provide(scope))),
              Effect.map((cache) => {
                const cached = (key: RedisArgument) =>
                  check.pipe(
                    Effect.andThen(observeTracking(manager, generation, cache.getBytes(key))),
                  );
                return {
                  clear: cache.clear,
                  snapshot: cache.snapshot,
                  getBytes: cached,
                  getKey: <A, RD, RE>(key: RedisKey<A, RD, RE>) =>
                    cached(key.name).pipe(
                      Effect.flatMap((value) =>
                        Option.isNone(value)
                          ? Effect.succeed(Option.none<A>())
                          : key.codec.decode(value.value).pipe(Effect.map(Option.some)),
                      ),
                    ),
                };
              }),
            ),
        };
      }),
    );

  return { pubsub, tracking };
};
