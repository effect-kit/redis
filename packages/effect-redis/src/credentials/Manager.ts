import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Redacted,
  Schema,
  Scope,
  Semaphore,
} from "effect";

import { CredentialValues, decodeRefreshPolicy, provider } from "#/credentials/Provider";
import type { CredentialProvider } from "#/credentials/Provider";
import { CredentialError } from "#/errors/CredentialError";

export interface CredentialSnapshot {
  readonly credentials: CredentialValues | undefined;
  readonly revision: number;
}

interface Pending {
  readonly result: Deferred.Deferred<CredentialSnapshot, CredentialError>;
  fiber?: Fiber.Fiber<void, never>;
}

/** Cache and refresh workers belong to one deployment Scope, never to a process-global provider. */
export const makeCredentialManager = Effect.fnUntraced(function* <R>(
  source: CredentialProvider<R>,
) {
  const policy = yield* decodeRefreshPolicy(source.policy);
  const captured = yield* Effect.context<R>();
  const owner = yield* Effect.scope;
  const mutex = yield* Semaphore.make(1);
  let closed = false;
  let revision = 0;
  let waiting = 0;
  let acquisitions = 0;
  let failures = 0;
  let cacheHits = 0;
  let cached: CredentialSnapshot | undefined;
  let pending: Pending | undefined;
  let fatal: Cause.Cause<never> | undefined;

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      cached = undefined;
    }),
  );

  const start = Effect.gen(function* () {
    if (closed) return yield* new CredentialError({ reason: "closed" });
    if (fatal !== undefined) return yield* Effect.failCause(fatal);
    const now = yield* Clock.currentTimeMillis;
    const expiry = cached?.credentials?.expiresAtMillis;
    if (cached !== undefined && expiry !== undefined && expiry - policy.refreshBeforeMillis > now) {
      cacheHits++;
      return { _tag: "Cached" as const, snapshot: cached };
    }
    if (waiting >= policy.maxWaiters) return yield* new CredentialError({ reason: "capacity" });

    const active: Pending = pending ?? {
      result: Deferred.makeUnsafe<CredentialSnapshot, CredentialError>(),
    };
    if (pending === undefined) {
      pending = active;
      const startedRevision = revision;
      acquisitions++;

      const acquire = Effect.gen(function* () {
        const input = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            return yield* source.acquire.pipe(
              Effect.provideContext(Context.add(captured, Scope.Scope, scope)),
            );
          }),
        ).pipe(
          Effect.mapError(
            (cause) => new CredentialError({ reason: "acquisition", cause: Redacted.make(cause) }),
          ),
          Effect.timeoutOrElse({
            duration: policy.acquisitionTimeoutMillis,
            orElse: () => Effect.fail(new CredentialError({ reason: "timeout" })),
          }),
        );
        const credentials =
          input === undefined
            ? undefined
            : yield* Schema.decodeUnknownEffect(CredentialValues, { onExcessProperty: "error" })(
                input,
              ).pipe(Effect.mapError(() => new CredentialError({ reason: "configuration" })));
        const completedAt = yield* Clock.currentTimeMillis;
        if (
          credentials?.expiresAtMillis !== undefined &&
          credentials.expiresAtMillis - policy.refreshBeforeMillis <= completedAt
        )
          return yield* new CredentialError({ reason: "expired" });
        if (revision !== startedRevision) return yield* new CredentialError({ reason: "rotated" });

        const snapshot = { credentials, revision: startedRevision };
        cached = snapshot;
        return snapshot;
      });

      active.fiber = yield* Effect.forkIn(
        acquire.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (pending === active) pending = undefined;
              if (Exit.isFailure(exit)) failures++;
              if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
                fatal = Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason));
              Deferred.doneUnsafe(active.result, exit);
            }),
          ),
          Effect.exit,
          Effect.asVoid,
        ),
        owner,
      );
    }
    waiting++;
    return { _tag: "Pending" as const, active };
  });

  const get = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const selected = yield* mutex.withPermits(1)(start);
      if (selected._tag === "Cached") return selected.snapshot;

      return yield* restore(Deferred.await(selected.active.result)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            waiting--;
          }),
        ),
      );
    }),
  );

  const invalidate = mutex
    .withPermits(1)(
      Effect.gen(function* () {
        if (closed) return yield* new CredentialError({ reason: "closed" });
        revision++;
        cached = undefined;
        const active = pending;
        pending = undefined;
        if (active !== undefined) {
          yield* Deferred.fail(active.result, new CredentialError({ reason: "rotated" }));
          if (active.fiber !== undefined) yield* Fiber.interrupt(active.fiber);
        }
      }),
    )
    .pipe(Effect.uninterruptible);

  return {
    get,
    invalidate,
    revision: () => revision,
    snapshot: Effect.sync(() => ({
      closed,
      revision,
      waiting,
      acquisitions,
      failures,
      cacheHits,
      refreshing: pending !== undefined,
    })),
  };
});

export type CredentialManager = Effect.Success<ReturnType<typeof makeCredentialManager>>;
export type RedisCredentialService = CredentialManager & {
  readonly rotate: Effect.Effect<void, CredentialError>;
};

export class RedisCredentials extends Context.Service<RedisCredentials, RedisCredentialService>()(
  "@envoy1084/effect-redis/RedisCredentials",
) {
  static readonly provider = provider;
}
