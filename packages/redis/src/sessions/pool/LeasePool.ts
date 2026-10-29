import { Cause, Context, Effect, Exit, Redacted, Scope, Semaphore } from "effect";

import { decodePolicy } from "#/connection/Options";
import type { ConnectionOptions } from "#/connection/Options";
import { ConnectionError } from "#/errors/ConnectionError";
import { ProtocolError } from "#/errors/ProtocolError";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { SessionError } from "#/errors/SessionError";
import { TransportError } from "#/errors/TransportError";
import type { RedisConfig } from "#/RedisConfig";
import type { SessionPolicy } from "#/sessions/pool/Options";
import { makeSessionWire } from "#/sessions/pool/Wire";
import type { SessionWire } from "#/sessions/pool/Wire";
import type { Transport } from "#/transport/Transport";

export type LeaseMode = "session" | "blocking";

interface Entry {
  readonly mode: LeaseMode;
  readonly wire: SessionWire;
}

const unavailable = (reason: SessionError["reason"] = "closed") =>
  new SessionError({ reason, delivery: "unsent" });

/** Separate bounded lanes keep waiting blocking consumers from exhausting session capacity. */
export const makeLeasePool = Effect.fnUntraced(function* <R>(
  config: RedisConfig,
  policy: SessionPolicy,
  connection: ConnectionOptions<R>,
) {
  const { credentials, ...policyInput } = connection;
  const connectionPolicy = yield* decodePolicy(policyInput);
  if (credentials !== undefined && config.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "connection.credentials",
      reason: "Choose fixed credentials or an Effect credential source",
    });
  const captured = yield* Effect.context<R | Transport>();
  const owner = yield* Scope.fork(yield* Effect.scope);
  const sessionPermits = yield* Semaphore.make(policy.maxSessionConnections);
  const blockingPermits = yield* Semaphore.make(policy.maxBlockingConnections);
  const idle: Record<LeaseMode, Entry[]> = { session: [], blocking: [] };
  const waitingByMode: Record<LeaseMode, number> = { session: 0, blocking: 0 };
  const entries = new Set<Entry>();

  let closed = false;
  let fatal: Cause.Cause<never> | undefined;
  let waiting = 0;
  let leased = 0;
  let generation = 0;
  let retired = 0;

  const discard = (entry: Entry) =>
    entry.wire.close.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          entries.delete(entry);
          retired++;
          if (Exit.isFailure(exit)) fatal = exit.cause;
        }),
      ),
    );

  const open = Effect.fnUntraced(function* (mode: LeaseMode) {
    let entry = idle[mode].shift();
    while (entry !== undefined) {
      if (entry.wire.isReady()) return entry;
      const defect = entry.wire.fatal();
      yield* discard(entry);
      if (defect !== undefined) {
        fatal = defect;
        return yield* Effect.failCause(defect);
      }
      entry = idle[mode].shift();
    }

    const scope = yield* Scope.fork(owner);
    const wire = yield* makeSessionWire(
      ++generation,
      scope,
      config,
      { ...connectionPolicy, ...(credentials === undefined ? {} : { credentials }) },
      connectionPolicy,
    ).pipe(
      Effect.provideContext(Context.add(captured, Scope.Scope, scope)),
      Effect.mapError((error) =>
        error instanceof TransportError || error instanceof ProtocolError
          ? new ConnectionError({
              reason: error instanceof ProtocolError ? "protocol" : "transport",
              generation,
              delivery: "unsent",
              cause: Redacted.make(error),
            })
          : error,
      ),
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? Scope.close(scope, Exit.void).pipe(
              Effect.onExit((cleanup) =>
                Effect.sync(() => {
                  if (Exit.isFailure(cleanup)) fatal = cleanup.cause;
                }),
              ),
            )
          : Effect.void,
      ),
    );
    const created = { mode, wire };
    entries.add(created);

    if (closed) {
      yield* discard(created);
      return yield* unavailable();
    }

    return created;
  });

  const release = (entry: Entry) =>
    Effect.gen(function* () {
      if (entry.wire.pending() !== 0) {
        const drained = yield* Effect.result(
          entry.wire.drain.pipe(
            Effect.timeoutOrElse({
              duration: policy.cleanupTimeoutMillis,
              orElse: () =>
                Effect.fail(new SessionError({ reason: "cleanup", delivery: "replied" })),
            }),
          ),
        );
        if (drained._tag === "Failure") {
          entry.wire.retire();
          yield* discard(entry);
          return yield* drained.failure;
        }
      }

      if (closed || !entry.wire.isReady()) {
        const defect = entry.wire.fatal();
        if (defect !== undefined) fatal = defect;
        yield* discard(entry);
        if (defect !== undefined) return yield* Effect.failCause(defect);
      } else idle[entry.mode].push(entry);
    });

  const use = <A, E, RUse>(
    mode: LeaseMode,
    body: (wire: SessionWire) => Effect.Effect<A, E, RUse>,
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (fatal !== undefined) return yield* Effect.failCause(fatal);
        if (closed) return yield* unavailable();
        const permits = mode === "blocking" ? blockingPermits : sessionPermits;
        const immediate = yield* permits.takeIfAvailable(1);

        if (!immediate) {
          if (waiting >= policy.maxWaiters) return yield* unavailable("pool-full");
          waiting++;
          waitingByMode[mode]++;

          yield* restore(
            permits.take(1).pipe(
              Effect.timeoutOrElse({
                duration: policy.leaseTimeoutMillis,
                orElse: () => Effect.fail(unavailable("lease-timeout")),
              }),
            ),
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                waiting--;
                waitingByMode[mode]--;
              }),
            ),
          );
        }

        leased++;
        let entry: Entry | undefined;

        return yield* Effect.gen(function* () {
          if (fatal !== undefined) return yield* Effect.failCause(fatal);
          if (closed) return yield* unavailable();
          entry = yield* restore(open(mode));
          const active = entry;

          return yield* restore(Effect.suspend(() => body(active.wire))).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
                ? Effect.sync(active.wire.retire)
                : Effect.void,
            ),
          );
        }).pipe(
          Effect.onExit(() =>
            (entry === undefined ? Effect.void : release(entry)).pipe(
              Effect.ensuring(
                Effect.gen(function* () {
                  leased--;
                  yield* permits.release(1);
                  // Semaphore wakes are scheduled. Let existing lane waiters run
                  // before this worker can immediately acquire the same permit again.
                  if (waitingByMode[mode] > 0) yield* Effect.yieldNow;
                }),
              ),
            ),
          ),
        );
      }),
    );

  const close = Effect.uninterruptible(
    Effect.gen(function* () {
      if (closed) return;
      closed = true;
      idle.session.length = 0;
      idle.blocking.length = 0;

      // Wake acquisition waiters; their closed check returns permits without opening sockets.
      yield* sessionPermits.releaseAll;
      yield* blockingPermits.releaseAll;
      // Retire FIFO ownership before Scope interrupts the reader/writer workers.
      for (const entry of entries) entry.wire.retire();
      yield* Scope.close(owner, Exit.void);
      entries.clear();
    }),
  );
  yield* Effect.addFinalizer(() => close);

  return {
    use,
    close,
    fatal: () => fatal,
    snapshot: Effect.sync(() => ({
      closed,
      waiting,
      leased,
      connections: entries.size,
      idle: idle.session.length + idle.blocking.length,
      generations: generation,
      retired,
    })),
  };
});

export type LeasePool = Effect.Success<ReturnType<typeof makeLeasePool>>;
