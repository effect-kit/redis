import { Context, Effect, Exit, Scope, Stream } from "effect";
import type { Cause } from "effect";

import type { NodeRegistry } from "#/cluster/nodes/Registry";
import type { ClusterOptions, ClusterPolicy } from "#/cluster/Options";
import { sameSlot } from "#/cluster/routing/Route";
import type { ClusterTarget } from "#/cluster/sessions/Sessions";
import { makeClusterSessionValidation } from "#/cluster/sessions/Validation";
import { keySlot } from "#/cluster/Slot";
import type { Discovery } from "#/cluster/topology/Discovery";
import { primaryForSlot } from "#/cluster/topology/Types";
import type { Command, PreparedCommand } from "#/command/Command";
import { Arguments, parse } from "#/commands/internal/Input";
import { spublish } from "#/commands/pubsub/Publish";
import { getBytes } from "#/commands/strings/Get";
import { ClusterError } from "#/errors/ClusterError";
import type { RedisKey } from "#/keys/RedisKey";
import type { RedisArgument } from "#/RedisArgument";
import type { RedisConfig } from "#/RedisConfig";
import type { SubscriptionOptions } from "#/subscriptions/Options";
import { makeRedisPubSub } from "#/subscriptions/RedisPubSub";
import type { SubscribeOptions } from "#/subscriptions/Types";
import type { CacheOptions } from "#/tracking/cache/Cache";
import type { TrackingRuntimeOptions } from "#/tracking/Options";
import { makeRedisTracking } from "#/tracking/RedisTracking";
import type { Transport } from "#/transport/Transport";

export const makeClusterEvents = Effect.fnUntraced(function* <R>(
  registry: NodeRegistry,
  discovery: Discovery,
  policy: ClusterPolicy,
  options: ClusterOptions<R>,
  database: number,
) {
  const captured = yield* Effect.context<R | Transport>();
  let active = 0;
  let fatal: Cause.Cause<never> | undefined;

  const open = <A, E>(
    target: ClusterTarget,
    acquire: (
      config: RedisConfig,
      scope: Scope.Closeable,
      check: Effect.Effect<void, ClusterError>,
      validate: ReturnType<typeof makeClusterSessionValidation>,
    ) => Effect.Effect<A, E, R | Transport | Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      if (fatal !== undefined) return yield* Effect.failCause(fatal);
      if (active >= policy.maxEventCohorts)
        return yield* new ClusterError({ reason: "capacity", delivery: "unsent" });
      const topology = yield* discovery.ensure;
      const node =
        "node" in target
          ? topology.shards.find((shard) => shard.primary.id === target.node)?.primary
          : primaryForSlot(topology, keySlot(target.key))?.primary;
      if (node === undefined)
        return yield* new ClusterError({ reason: "node-unavailable", delivery: "unsent" });
      const caller = yield* Effect.scope;

      return yield* registry.withNode(node.address, (entry) =>
        Effect.gen(function* () {
          if (active >= policy.maxEventCohorts)
            return yield* new ClusterError({ reason: "capacity", delivery: "unsent" });
          const scope = yield* Scope.fork(entry.scope);
          active++;
          let lost = false;
          let alive = true;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              active--;
              alive = false;
            }),
          ).pipe(Scope.provide(scope));
          const close = Scope.close(scope, Exit.void).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit)) {
                  fatal = exit.cause;
                  registry.poison(exit.cause);
                }
              }),
            ),
          );
          yield* Scope.addFinalizer(caller, close);
          yield* discovery
            .observe(
              Effect.sync(() => {
                lost = true;
              }).pipe(Effect.andThen(close)),
            )
            .pipe(Scope.provide(scope));
          const check = registry.check.pipe(
            Effect.andThen(
              Effect.suspend(() =>
                lost || !alive
                  ? Effect.fail(
                      new ClusterError({ reason: "topology-changed", delivery: "unsent" }),
                    )
                  : Effect.void,
              ),
            ),
          );
          const validate = makeClusterSessionValidation(
            discovery,
            node,
            database,
            "key" in target ? keySlot(target.key) : undefined,
          );
          return yield* acquire(entry.config, scope, check, validate).pipe(
            Effect.provideContext(Context.add(captured, Scope.Scope, scope)),
            Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)),
          );
        }),
      );
    });

  const pubsub = (target: ClusterTarget, selected: Omit<SubscriptionOptions, "credentials"> = {}) =>
    open(target, (config, scope, check, validate) =>
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
          Effect.gen(function* () {
            yield* check;
            const values = yield* parse(Arguments, targets);
            if (selection.mode === "shard") {
              yield* sameSlot(values);
              for (const channel of values)
                yield* validate.command(yield* spublish(channel, "").prepare);
            }
            const subscription = yield* client
              .subscribe(values, selection)
              .pipe(Scope.provide(scope));
            // Topology invalidation terminates the old view explicitly; callers reacquire on the new owner.
            const guard = <A, E, RStream>(stream: Stream.Stream<A, E, RStream>) =>
              stream.pipe(
                Stream.catchCause((cause) =>
                  Stream.fromEffect(check.pipe(Effect.andThen(Effect.failCause(cause)))),
                ),
              );
            return {
              ...subscription,
              events: guard(subscription.events),
              messages: guard(subscription.messages),
            };
          });
        return {
          subscribe,
          psubscribe: (
            targets: readonly [RedisArgument, ...RedisArgument[]],
            selection?: Omit<SubscribeOptions, "mode">,
          ) => subscribe(targets, { ...selection, mode: "pattern" }),
          ssubscribe: (
            targets: readonly [RedisArgument, ...RedisArgument[]],
            selection?: Omit<SubscribeOptions, "mode">,
          ) => subscribe(targets, { ...selection, mode: "shard" }),
          snapshot: client.snapshot,
          unknownPushes: client.unknownPushes,
        };
      }),
    );

  const tracking = (
    target: ClusterTarget,
    selected: Omit<TrackingRuntimeOptions, "credentials"> = {},
  ) =>
    open(target, (config, scope, check, validate) =>
      Effect.gen(function* () {
        const client = yield* makeRedisTracking(config, {
          ...selected,
          ...(options.connection?.credentials === undefined
            ? {}
            : { credentials: options.connection.credentials }),
        });
        const prepared = <A, E, RD>(command: PreparedCommand<A, E, RD>) =>
          check.pipe(Effect.andThen(validate.command(command)));
        const key = (name: RedisArgument) => getBytes(name).prepare.pipe(Effect.flatMap(prepared));
        const execute = <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
          command.prepare.pipe(
            Effect.flatMap((intent) =>
              prepared(intent).pipe(
                Effect.andThen(client.execute({ prepare: Effect.succeed(intent) })),
              ),
            ),
          );
        return {
          ...client,
          execute,
          getBytes: (name: RedisArgument) => key(name).pipe(Effect.andThen(client.getBytes(name))),
          caching: <A, E, RD, RE>(mode: "YES" | "NO", command: Command<A, E, RD, RE>) =>
            command.prepare.pipe(
              Effect.flatMap((intent) =>
                prepared(intent).pipe(
                  Effect.andThen(client.caching(mode, { prepare: Effect.succeed(intent) })),
                ),
              ),
            ),
          restart: check.pipe(Effect.andThen(client.restart)),
          cache: (cacheOptions?: CacheOptions) =>
            check.pipe(
              Effect.andThen(client.cache(cacheOptions).pipe(Scope.provide(scope))),
              Effect.map((cache) => ({
                clear: cache.clear,
                snapshot: cache.snapshot,
                getBytes: (name: RedisArgument) =>
                  key(name).pipe(Effect.andThen(cache.getBytes(name))),
                getKey: <A, RD, RE>(typed: RedisKey<A, RD, RE>) =>
                  key(typed.name).pipe(Effect.andThen(cache.getKey(typed))),
              })),
            ),
        };
      }),
    );

  return { pubsub, tracking, snapshot: () => ({ eventCohorts: active }) };
});
