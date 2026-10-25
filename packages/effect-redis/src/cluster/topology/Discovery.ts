import { Clock, Deferred, Effect, Exit } from "effect";

import type { NodeRegistry } from "#/cluster/nodes/Registry";
import type { ClusterPolicy } from "#/cluster/Options";
import { decodeShards, decodeSlots, validateTopology } from "#/cluster/topology/Decode";
import { addressIdentity, ownTopology, topologyIdentity } from "#/cluster/topology/Types";
import type { ClusterAddress, ClusterTopology } from "#/cluster/topology/Types";
import { checkServerReply } from "#/command/Decode";
import type { RedisError } from "#/command/Executor";
import { undecorate } from "#/command/reply/Scalars";
import { ClusterError } from "#/errors/ClusterError";
import type { RespValue } from "#/protocol/RespValue";

const unsupportedShards = (reply: RespValue) => {
  const value = undecorate(reply);
  if (value._tag !== "SimpleError" || value.value.length > 2048) return false;
  const text = new TextDecoder().decode(value.value);
  // Permission/auth failures do not authorize discovery fallback.
  return /^ERR (?:Unknown subcommand or wrong number of arguments for 'SHARDS'|unknown subcommand 'shards'|unknown command ['`]CLUSTER['`])/i.test(
    text,
  );
};

export const makeDiscovery = (
  registry: NodeRegistry,
  seeds: ReadonlyArray<ClusterAddress>,
  policy: ClusterPolicy,
  tls: boolean,
) => {
  let current: ClusterTopology | undefined;
  let refreshedAt = 0;
  let pending: Deferred.Deferred<ClusterTopology, RedisError> | undefined;
  let failures = 0;
  let refreshWaiters = 0;
  let unhealthy: string | undefined;
  const observers = new Set<Effect.Effect<void>>();
  const invalidate = Effect.suspend(() =>
    Effect.forEach(observers, (observer) => observer, { discard: true }),
  );

  const discover = Effect.fnUntraced(function* () {
    const candidates = new Map<string, ClusterAddress>();
    if (unhealthy === undefined)
      for (const seed of seeds) candidates.set(addressIdentity(seed), seed);
    for (const shard of current?.shards ?? [])
      candidates.set(addressIdentity(shard.primary.address), shard.primary.address);
    for (const seed of seeds) candidates.set(addressIdentity(seed), seed);
    let last: RedisError = new ClusterError({ reason: "node-unavailable", delivery: "unsent" });

    const ordered = [...candidates.values()].filter(
      (address) => addressIdentity(address) !== unhealthy,
    );
    const deferred = unhealthy === undefined ? undefined : candidates.get(unhealthy);
    if (deferred !== undefined) ordered.push(deferred);
    for (const address of ordered) {
      const result = yield* Effect.result(
        registry.use(address, "session", (wire) =>
          Effect.gen(function* () {
            const modern = policy.discovery !== "slots";
            let reply = yield* wire.execute(["CLUSTER", modern ? "SHARDS" : "SLOTS"]);
            let slots = !modern;
            if (modern && policy.discovery === "auto" && unsupportedShards(reply)) {
              slots = true;
              reply = yield* wire.execute(["CLUSTER", "SLOTS"]);
            }
            yield* checkServerReply(reply);
            return yield* validateTopology(
              yield* slots
                ? decodeSlots(reply, address.host)
                : decodeShards(reply, address.host, tls),
              policy.maxNodes,
            );
          }),
        ),
      );
      if (result._tag === "Failure") {
        last = result.failure;
        // Trying another seed is useful only for unavailable transport, not an ACL/protocol rejection.
        if (
          last._tag !== "ConnectionError" &&
          !(last._tag === "ClusterError" && last.reason === "invalid-topology")
        )
          return yield* last;
        continue;
      }

      const changed =
        current === undefined ||
        topologyIdentity(current.shards) !== topologyIdentity(result.success);
      const next = Object.freeze({
        revision: (current?.revision ?? 0) + (changed ? 1 : 0),
        shards: ownTopology(result.success),
      });
      // Clear topology-bound state before any caller can route through the replacement snapshot.
      if (changed && current !== undefined) yield* invalidate;
      current = next;
      unhealthy = undefined;
      refreshedAt = yield* Clock.currentTimeMillis;
      const retained = new Set(seeds.map(addressIdentity));
      for (const shard of next.shards)
        for (const node of [shard.primary, ...shard.replicas])
          retained.add(addressIdentity(node.address));
      yield* registry.prune(retained);
      return next;
    }
    return yield* last;
  });

  const refreshOne = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (pending !== undefined) return yield* restore(Deferred.await(pending));
      const receipt = yield* Deferred.make<ClusterTopology, RedisError>();
      pending = receipt;
      // The owner publishes cancellation too; waiters never inherit an orphaned refresh receipt.
      return yield* restore(discover()).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit)) failures++;
            pending = undefined;
            Deferred.doneUnsafe(receipt, exit);
          }),
        ),
      );
    }),
  );

  const refresh = Effect.acquireUseRelease(
    Effect.suspend(() => {
      if (refreshWaiters >= policy.maxOperations)
        return Effect.fail(new ClusterError({ reason: "capacity", delivery: "unsent" }));
      refreshWaiters++;
      return Effect.void;
    }),
    () =>
      refreshOne.pipe(
        Effect.timeoutOrElse({
          duration: policy.operationTimeoutMillis,
          orElse: () => Effect.fail(new ClusterError({ reason: "timeout", delivery: "unsent" })),
        }),
      ),
    () =>
      Effect.sync(() => {
        refreshWaiters--;
      }),
  );

  const ensure = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return current === undefined || now - refreshedAt >= policy.refreshIntervalMillis
      ? yield* refresh
      : current;
  });

  const observe = (observer: Effect.Effect<void>) =>
    Effect.acquireRelease(
      Effect.suspend(() =>
        observers.size >= policy.maxOperations
          ? Effect.fail(new ClusterError({ reason: "capacity", delivery: "unsent" }))
          : Effect.sync(() => {
              observers.add(observer);
            }),
      ),
      () =>
        Effect.sync(() => {
          observers.delete(observer);
        }),
    );

  return {
    refresh,
    ensure,
    invalidate,
    observe,
    stale: (address?: ClusterAddress) => {
      refreshedAt = Number.NEGATIVE_INFINITY;
      unhealthy = address === undefined ? undefined : addressIdentity(address);
    },
    current: () => current,
    failures: () => failures,
  };
};

export type Discovery = ReturnType<typeof makeDiscovery>;
