import { Clock, Deferred, Effect, Exit } from "effect";
import type { Cause, Scope } from "effect";

import type { CredentialLifetime } from "#/credentials/Lifetime";
import type { CredentialSnapshot } from "#/credentials/Manager";
import { CredentialPlane } from "#/credentials/Plane";
import { CredentialError } from "#/errors/CredentialError";
import { TransportError } from "#/errors/TransportError";
import type { Transport } from "#/transport/Transport";

export interface Binding {
  readonly close: Effect.Effect<void, TransportError>;
  readonly scope: Scope.Scope;
  readonly openedAt: number;
  readonly isClosed: () => boolean;
  owner?: symbol;
  readonly plane: "data" | "sentinel";
}

/** Socket lifetimes are explicit policy. Retirement never inserts AUTH into an existing FIFO. */
const expired = (stage: "read" | "write") =>
  Effect.fail(new TransportError({ stage, reason: "closed" }));

export const makeCredentialBindings = (transport: Transport["Service"]) =>
  Effect.sync(() => {
    const sockets = new Set<Binding>();
    const byScope = new WeakMap<Scope.Scope, Binding>();

    const open: Transport["Service"]["open"] = Effect.fnUntraced(function* (config) {
      const scope = yield* Effect.scope;
      const plane = yield* CredentialPlane;
      const physical = yield* transport.open(config);
      const openedAt = yield* Clock.currentTimeMillis;
      const retired = yield* Deferred.make<void>();
      let closed = false;
      let failure: Cause.Cause<TransportError> | undefined;

      const close = Effect.gen(function* () {
        closed = true;
        yield* Deferred.succeed(retired, undefined);
        const exit = yield* Effect.exit(physical.close);
        if (Exit.isFailure(exit)) {
          failure = exit.cause;
          return yield* Effect.failCause(exit.cause);
        }
      }).pipe(Effect.uninterruptible);
      const binding: Binding = { close, scope, openedAt, isClosed: () => closed, plane };
      sockets.add(binding);
      byScope.set(scope, binding);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          sockets.delete(binding);
          byScope.delete(scope);
          // Timer failures poison physical cleanup too, preventing unsafe replacement acquisition.
          if (failure !== undefined) return yield* Effect.failCause(failure);
        }).pipe(Effect.orDie),
      );

      return {
        read: Effect.suspend(() =>
          closed
            ? expired("read")
            : Effect.raceFirst(
                physical.read,
                Deferred.await(retired).pipe(Effect.andThen(expired("read"))),
              ),
        ),
        write: (bytes) =>
          Effect.suspend(() =>
            closed
              ? expired("write")
              : Effect.raceFirst(
                  physical.write(bytes),
                  Deferred.await(retired).pipe(Effect.andThen(expired("write"))),
                ),
          ),
        close,
      };
    });

    const claim = Effect.fnUntraced(function* (owner: symbol, plane: "data" | "sentinel" = "data") {
      const scope = yield* Effect.scope;
      const binding = byScope.get(scope);
      if (binding === undefined || binding.isClosed())
        return yield* new CredentialError({ reason: "closed" });
      if (binding.owner !== undefined && binding.owner !== owner)
        return yield* new CredentialError({ reason: "configuration" });
      if (binding.plane !== plane) return yield* new CredentialError({ reason: "configuration" });
      binding.owner = owner;
      return binding;
    });

    const bind = Effect.fnUntraced(function* (
      snapshot: CredentialSnapshot,
      policy: typeof CredentialLifetime.Type,
      owner: symbol,
      plane: "data" | "sentinel" = "data",
    ) {
      const binding = yield* claim(owner, plane);
      if (policy.mode === "reconnect") return snapshot.credentials;
      const deadline =
        policy.mode === "max-age"
          ? binding.openedAt + policy.maxAgeMillis
          : snapshot.credentials?.expiresAtMillis === undefined
            ? undefined
            : snapshot.credentials.expiresAtMillis - policy.retireBeforeMillis;
      if (deadline === undefined) return yield* new CredentialError({ reason: "configuration" });
      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return yield* new CredentialError({ reason: "expired" });

      const retire = Effect.gen(function* () {
        let wait = remaining;
        while (wait > 0) {
          // Absolute token expiries can exceed the native timer's signed 32-bit range.
          yield* Effect.sleep(Math.min(wait, 86_400_000));
          wait = deadline - (yield* Clock.currentTimeMillis);
        }
        yield* binding.close;
      });
      yield* Effect.forkIn(retire.pipe(Effect.exit), binding.scope);
      return snapshot.credentials;
    });

    return {
      transport: { open },
      claim,
      bind,
      sockets: (owner: symbol) => Array.from(sockets).filter((socket) => socket.owner === owner),
      plane: (plane: "data" | "sentinel") =>
        Array.from(sockets).filter((socket) => socket.plane === plane),
      snapshot: Effect.sync(() => ({ connections: sockets.size })),
    };
  });

export type CredentialBindings = Effect.Success<ReturnType<typeof makeCredentialBindings>>;
