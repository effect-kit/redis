import { Context, Effect, Exit, Scope, Semaphore } from "effect";
import type { Cause } from "effect";

import type { ClusterOptions, ClusterPolicy } from "#/cluster/Options";
import { decodeAddress } from "#/cluster/topology/Decode";
import { addressIdentity } from "#/cluster/topology/Types";
import type { ClusterAddress } from "#/cluster/topology/Types";
import { ClusterError } from "#/errors/ClusterError";
import type { RedisConfig } from "#/RedisConfig";
import { makeLeasePool } from "#/sessions/pool/LeasePool";
import type { LeaseMode, LeasePool } from "#/sessions/pool/LeasePool";
import { decodeSessionPolicy } from "#/sessions/pool/Options";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { Transport } from "#/transport/Transport";

interface Entry {
  readonly scope: Scope.Closeable;
  readonly pool: LeasePool;
  readonly config: RedisConfig;
  users: number;
  retiring: boolean;
}

/** The registry counts retiring resources too, so topology churn cannot grow pools without bound. */
export const makeNodeRegistry = Effect.fnUntraced(function* <R>(
  base: RedisConfig,
  policy: ClusterPolicy,
  options: ClusterOptions<R>,
) {
  const captured = yield* Effect.context<R | Transport>();
  const owner = yield* Scope.fork(yield* Effect.scope);
  const lock = yield* Semaphore.make(1);
  const sessionPolicy = yield* decodeSessionPolicy(options.sessions ?? {});
  const entries = new Map<string, Entry>();
  let closed = false;
  let fatal: Cause.Cause<never> | undefined;

  const remove = (identity: string, entry: Entry) =>
    Scope.close(entry.scope, Exit.void).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) fatal = exit.cause;
          entries.delete(identity);
        }),
      ),
    );

  const configuration = Effect.fnUntraced(function* (address: ClusterAddress) {
    const mapped = options.addressMap === undefined ? address : options.addressMap({ ...address });
    const dial = yield* decodeAddress(mapped);
    const tls = base.endpoint._tag === "Tcp" ? base.endpoint.tls : undefined;
    const serverName =
      "serverName" in mapped && mapped.serverName !== undefined ? mapped.serverName : address.host;
    if (typeof serverName !== "string")
      return yield* new ClusterError({ reason: "invalid-topology", delivery: "unsent" });

    return {
      ...base,
      endpoint: {
        _tag: "Tcp",
        ...dial,
        ...(tls === undefined ? {} : { tls: { ...tls, serverName } }),
      },
    } satisfies RedisConfig;
  });

  const acquire = (address: ClusterAddress) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (fatal !== undefined) return yield* Effect.failCause(fatal);
        if (closed) return yield* new ClusterError({ reason: "closed", delivery: "unsent" });
        const identity = addressIdentity(address);
        let entry = entries.get(identity);
        if (entry?.retiring)
          return yield* new ClusterError({ reason: "node-unavailable", delivery: "unsent" });
        if (entry === undefined) {
          if (entries.size >= policy.maxNodes)
            return yield* new ClusterError({ reason: "capacity", delivery: "unsent" });
          const config = yield* configuration(address);
          const scope = yield* Scope.fork(owner);
          const pool = yield* makeLeasePool(config, sessionPolicy, options.connection ?? {}).pipe(
            Effect.provideContext(Context.add(captured, Scope.Scope, scope)),
            Effect.mapError(
              () => new ClusterError({ reason: "invalid-topology", delivery: "unsent" }),
            ),
            Effect.onExit((exit) =>
              Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void,
            ),
          );
          entry = { scope, pool, config, users: 0, retiring: false };
          entries.set(identity, entry);
        }
        entry.users++;
        return entry;
      }),
    );

  const withNode = <A, E, RUse>(
    address: ClusterAddress,
    body: (entry: Entry) => Effect.Effect<A, E, RUse>,
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const entry = yield* acquire(address);
        return yield* restore(Effect.suspend(() => body(entry))).pipe(
          Effect.ensuring(
            lock.withPermit(
              Effect.gen(function* () {
                entry.users--;
                if (entry.retiring && entry.users === 0)
                  yield* remove(addressIdentity(address), entry);
              }),
            ),
          ),
        );
      }),
    );

  const use = <A, E, RUse>(
    address: ClusterAddress,
    mode: LeaseMode,
    body: (wire: SessionWire) => Effect.Effect<A, E, RUse>,
  ) => withNode(address, (entry) => entry.pool.use(mode, body));

  const prune = (retained: ReadonlySet<string>) =>
    lock.withPermit(
      Effect.gen(function* () {
        for (const [identity, entry] of entries) {
          if (retained.has(identity)) continue;
          entry.retiring = true;
          if (entry.users === 0) yield* remove(identity, entry);
        }
      }),
    );

  const close = Effect.uninterruptible(
    Effect.gen(function* () {
      closed = true;
      yield* Scope.close(owner, Exit.void);
      entries.clear();
    }),
  );
  yield* Effect.addFinalizer(() => close);

  return {
    use,
    withNode,
    configuration,
    prune,
    close,
    sessionPolicy,
    snapshot: Effect.sync(() => ({
      closed,
      nodes: entries.size,
      users: [...entries.values()].reduce((total, entry) => total + entry.users, 0),
    })),
  };
});

export type NodeRegistry = Effect.Success<ReturnType<typeof makeNodeRegistry>>;
