import {
  Array,
  Order,
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Scope,
  Semaphore,
} from "effect";

import type { RedisError } from "#/command/Executor";
import { RoleExpectation } from "#/connection/Role";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { SentinelError } from "#/errors/SentinelError";
import { TransportError } from "#/errors/TransportError";
import type { SentinelConfig } from "#/sentinel/Config";
import { addressIdentity, connectionConfig } from "#/sentinel/discovery/Address";
import { makeSentinelDiscovery } from "#/sentinel/discovery/Discovery";
import type { SentinelView } from "#/sentinel/discovery/Discovery";
import type { SentinelGeneration, SentinelNode } from "#/sentinel/generation/Types";
import type { SentinelOptions, SentinelPolicy } from "#/sentinel/Options";
import { makeLeasePool } from "#/sessions/pool/LeasePool";
import { decodeSessionPolicy } from "#/sessions/pool/Options";
import { Transport } from "#/transport/Transport";

const fingerprint = (view: SentinelView) =>
  JSON.stringify([
    addressIdentity(view.primary),
    ...Array.sort(view.replicas.map(addressIdentity), Order.String),
  ]);

/** One published generation owns every pool and event cohort for its discovered deployment. */
export const makeSentinelManager = Effect.fnUntraced(function* <R>(
  config: SentinelConfig,
  policy: SentinelPolicy,
  options: SentinelOptions<R>,
) {
  const captured = yield* Effect.context<R | Transport>();
  const transport = yield* Transport;
  const owner = yield* Scope.fork(yield* Effect.scope);
  const discovery = yield* makeSentinelDiscovery(config, policy, options).pipe(
    Scope.provide(owner),
  );
  const sessionPolicy = yield* decodeSessionPolicy(options.sessions ?? {});
  const lock = yield* Semaphore.make(1);
  let current: SentinelGeneration | undefined;
  let pending: Deferred.Deferred<SentinelGeneration, RedisError> | undefined;
  let fatal: Cause.Cause<never> | undefined;
  let closed = false;
  let nextId = 0;
  let refreshedAt = Number.NEGATIVE_INFINITY;
  let replicaIndex = 0;
  let refreshWaiters = 0;

  const check = (generation?: SentinelGeneration) =>
    Effect.suspend(() =>
      fatal !== undefined
        ? Effect.failCause(fatal)
        : closed
          ? Effect.fail(new SentinelError({ plane: "data", reason: "closed", delivery: "unsent" }))
          : generation?.obsolete
            ? Effect.fail(
                new SentinelError({
                  plane: "data",
                  reason: "topology-changed",
                  delivery: "unsent",
                }),
              )
            : Effect.void,
    );

  const invalidate = (generation: SentinelGeneration) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        generation.obsolete = true;
        refreshedAt = Number.NEGATIVE_INFINITY;
        // A failed cohort must not prevent other caches/subscriptions from being cleared.
        const exits = yield* Effect.forEach([...generation.observers], (close) =>
          Effect.exit(close),
        );
        const reasons = exits.flatMap((exit) => (Exit.isFailure(exit) ? exit.cause.reasons : []));
        if (reasons.length !== 0) {
          fatal = Cause.fromReasons(reasons);
          return yield* Effect.failCause(fatal);
        }
      }),
    );

  const retire = (generation: SentinelGeneration) =>
    invalidate(generation).pipe(
      Effect.ensuring(Scope.close(generation.scope, Exit.void)),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) fatal = exit.cause;
        }),
      ),
    );

  const refreshOne = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* check();
      const receipt = pending ?? Deferred.makeUnsafe<SentinelGeneration, RedisError>();
      if (pending === undefined) {
        pending = receipt;
        yield* Effect.forkIn(
          discovery.lookup.pipe(
            Effect.flatMap((view) =>
              lock.withPermit(
                Effect.gen(function* () {
                  yield* check();
                  if (
                    current !== undefined &&
                    !current.obsolete &&
                    fingerprint(current.view) === fingerprint(view)
                  ) {
                    refreshedAt = yield* Clock.currentTimeMillis;
                    return current;
                  }
                  if (current !== undefined) yield* retire(current);
                  yield* check();
                  const scope = yield* Scope.fork(owner);
                  current = {
                    id: ++nextId,
                    view,
                    scope,
                    pools: new Map(),
                    observers: new Set(),
                    obsolete: false,
                  };
                  refreshedAt = yield* Clock.currentTimeMillis;
                  return current;
                }),
              ),
            ),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
                  fatal = Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason));
                pending = undefined;
                Deferred.doneUnsafe(receipt, exit);
              }),
            ),
            // The receipt retains the complete Cause; fatal state also prevents replacement after defects.
            Effect.catchCause(() => Effect.void),
          ),
          owner,
        );
      }
      return yield* restore(Deferred.await(receipt));
    }),
  );

  const refresh = Effect.acquireUseRelease(
    Effect.suspend(() => {
      if (refreshWaiters >= policy.maxOperations)
        return Effect.fail(
          new SentinelError({ reason: "capacity", plane: "sentinel", delivery: "unsent" }),
        );
      refreshWaiters++;
      return Effect.void;
    }),
    () => refreshOne,
    () =>
      Effect.sync(() => {
        refreshWaiters--;
      }),
  );

  const ensure = Effect.gen(function* () {
    yield* check();
    const now = yield* Clock.currentTimeMillis;
    return current === undefined ||
      current.obsolete ||
      now - refreshedAt >= policy.refreshIntervalMillis
      ? yield* refresh
      : current;
  });

  const transportFor = (generation: SentinelGeneration, node: SentinelNode) => {
    return Transport.of({
      open: (requested) =>
        Effect.gen(function* () {
          // Every replacement socket re-resolves Sentinel, even when its pool still has the old address.
          const answer = yield* discovery.lookup.pipe(
            Effect.mapError(() => new TransportError({ stage: "open", reason: "unavailable" })),
          );
          const retained =
            addressIdentity(answer.primary) === addressIdentity(generation.view.primary) &&
            (node.role === "primary" ||
              answer.replicas.some(
                (replica) => addressIdentity(replica) === addressIdentity(node.address),
              ));
          if (!retained || generation.obsolete || closed) {
            generation.obsolete = true;
            return yield* new TransportError({ stage: "open", reason: "unavailable" });
          }
          return yield* transport.open(requested);
        }),
    });
  };

  const contextFor = (generation: SentinelGeneration, node: SentinelNode, scope: Scope.Scope) =>
    Context.add(
      Context.add(
        Context.add(captured, Scope.Scope, scope),
        Transport,
        transportFor(generation, node),
      ),
      RoleExpectation,
      node.role,
    );

  const pool = (generation: SentinelGeneration, node: SentinelNode) =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* check(generation);
        const identity = `${node.role}:${addressIdentity(node.address)}`;
        const existing = generation.pools.get(identity);
        if (existing !== undefined) return existing;
        if (generation.pools.size >= policy.maxDataNodes)
          return yield* new SentinelError({
            plane: "data",
            reason: "capacity",
            delivery: "unsent",
          });

        const mapped = yield* connectionConfig(config.data, node.address, "data", policy, options);
        const scope = yield* Scope.fork(generation.scope);

        const created = yield* makeLeasePool(mapped, sessionPolicy, options.connection ?? {}).pipe(
          Effect.mapError((error) =>
            error instanceof RedisConfigError
              ? new SentinelError({ reason: "invalid-reply", plane: "data", delivery: "unsent" })
              : error,
          ),
          Effect.provideContext(contextFor(generation, node, scope)),
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void,
          ),
        );
        generation.pools.set(identity, created);
        return created;
      }),
    );

  const observe = (generation: SentinelGeneration, close: Effect.Effect<void>) =>
    Effect.acquireRelease(
      check(generation).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (generation.observers.size >= policy.maxEventCohorts)
              return Effect.fail(
                new SentinelError({ plane: "data", reason: "capacity", delivery: "unsent" }),
              );
            generation.observers.add(close);
            return Effect.void;
          }),
        ),
      ),
      () =>
        Effect.sync(() => {
          generation.observers.delete(close);
        }),
    );

  const select = (generation: SentinelGeneration, replica: boolean): SentinelNode => {
    const selected = replica
      ? generation.view.replicas[replicaIndex++ % Math.max(1, generation.view.replicas.length)]
      : undefined;
    return selected === undefined
      ? { address: generation.view.primary, role: "primary" }
      : { address: selected, role: "replica" };
  };

  const close = Effect.uninterruptible(
    Effect.gen(function* () {
      if (closed) return;
      closed = true;
      if (current !== undefined) yield* retire(current);
    }).pipe(Effect.ensuring(Scope.close(owner, Exit.void))),
  );
  yield* Effect.addFinalizer(() => close);

  return {
    ensure,
    refresh,
    pool,
    contextFor,
    check,
    invalidate,
    observe,
    select,
    scope: owner,
    sessionPolicy,
    close,
    poison: (cause: Cause.Cause<never>) => {
      fatal = cause;
    },
    configure: (node: SentinelNode) =>
      connectionConfig(config.data, node.address, "data", policy, options),
    snapshot: Effect.sync(() => ({
      closed,
      refreshWaiters,
      revision: current?.id ?? 0,
      obsolete: current?.obsolete ?? false,
      pools: current?.pools.size ?? 0,
      eventCohorts: current?.observers.size ?? 0,
      ...discovery.snapshot(),
    })),
  };
});

export type SentinelManager<R = never> = Effect.Success<ReturnType<typeof makeSentinelManager<R>>>;
