import { Cause, Effect, Exit } from "effect";

import type { RedisError } from "#/command/Executor";
import { undecorate } from "#/command/reply/Scalars";
import { ConnectionError } from "#/errors/ConnectionError";
import { HandshakeError } from "#/errors/HandshakeError";
import { ProtocolError } from "#/errors/ProtocolError";
import { SentinelError } from "#/errors/SentinelError";
import { TransportError } from "#/errors/TransportError";
import type { RespValue } from "#/protocol/RespValue";
import type { SentinelConfig } from "#/sentinel/Config";
import { makeSentinelAdmission } from "#/sentinel/execution/Admission";
import { sentinelSessionValidation } from "#/sentinel/execution/Validation";
import type { SentinelManager } from "#/sentinel/generation/Manager";
import type { SentinelGeneration } from "#/sentinel/generation/Types";
import type { SentinelPolicy } from "#/sentinel/Options";
import type { LeaseMode } from "#/sessions/pool/LeasePool";
import type { SessionWire } from "#/sessions/pool/Wire";
import { makeSession } from "#/sessions/Session";
import type { RedisSession } from "#/sessions/Session";

const rejectedRole = (reply: RespValue) => {
  const value = undecorate(reply);
  if (value._tag !== "SimpleError" && value._tag !== "BlobError") return false;
  const prefix = "READONLY ";
  return (
    value.value.length >= prefix.length &&
    value.value.subarray(0, prefix.length).every((byte, index) => byte === prefix.charCodeAt(index))
  );
};

const connectionFailed = (error: unknown) =>
  error instanceof ConnectionError ||
  error instanceof HandshakeError ||
  error instanceof TransportError ||
  (error instanceof ProtocolError && error.stage !== "encode");

export const makeSentinelSessions = (
  manager: Omit<SentinelManager, "contextFor">,
  config: SentinelConfig,
  policy: SentinelPolicy,
) => {
  let nextWireId = 0;
  const identities = new WeakMap<SessionWire, number>();
  const admission = makeSentinelAdmission(policy.maxOperations, policy.operationTimeoutMillis);
  const useOnce = <A, E, R>(
    mode: LeaseMode,
    replica: boolean,
    body: (wire: SessionWire, generation: SentinelGeneration) => Effect.Effect<A, E, R>,
    state: { entered: boolean; generation?: SentinelGeneration },
    fixedGeneration?: SentinelGeneration,
  ) =>
    Effect.gen(function* () {
      const generation = fixedGeneration ?? (yield* manager.ensure);
      state.generation = generation;
      yield* manager.check(generation);
      const pool = yield* manager.pool(generation, manager.select(generation, replica));
      const observe = (reply: RespValue) => {
        if (rejectedRole(reply)) generation.obsolete = true;
      };
      return yield* pool
        .use(mode, (wire) => {
          state.entered = true;
          let identity = identities.get(wire);
          if (identity === undefined) {
            identity = ++nextWireId;
            identities.set(wire, identity);
          }
          return body(
            {
              ...wire,
              id: identity,
              execute: (...args) =>
                wire.execute(...args).pipe(
                  Effect.tap((reply) => Effect.sync(() => observe(reply))),
                  Effect.tapError((error) =>
                    Effect.sync(() => {
                      if (connectionFailed(error)) generation.obsolete = true;
                    }),
                  ),
                ),
              fence: (...args) =>
                wire.fence(...args).pipe(
                  Effect.tap((reply) => Effect.sync(() => observe(reply))),
                  Effect.tapError((error) =>
                    Effect.sync(() => {
                      if (connectionFailed(error)) generation.obsolete = true;
                    }),
                  ),
                ),
              batch: (...args) =>
                wire.batch(...args).pipe(
                  Effect.tap((outcomes) =>
                    Effect.sync(() => {
                      for (const outcome of outcomes) {
                        if (outcome._tag === "Replied") observe(outcome.reply);
                        else generation.obsolete = true;
                      }
                    }),
                  ),
                ),
            },
            generation,
          );
        })
        .pipe(
          Effect.tap(() =>
            fixedGeneration === undefined ? Effect.void : manager.check(generation),
          ),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const defect = pool.fatal();
              if (defect !== undefined) manager.poison(defect);
              const acquisitionFailed =
                !state.entered &&
                Exit.isFailure(exit) &&
                exit.cause.reasons.some(
                  (reason) => Cause.isFailReason(reason) && connectionFailed(reason.error),
                );
              if (generation.obsolete || acquisitionFailed) yield* manager.invalidate(generation);
            }),
          ),
        );
    });

  const use = <A, E, R>(
    mode: LeaseMode,
    replica: boolean,
    body: (wire: SessionWire, generation: SentinelGeneration) => Effect.Effect<A, E, R>,
    fixedGeneration?: SentinelGeneration,
  ): Effect.Effect<A, E | RedisError, R> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < policy.discoveryAttempts; attempt++) {
        const state: { entered: boolean; generation?: SentinelGeneration } = { entered: false };
        const result = yield* Effect.result(useOnce(mode, replica, body, state, fixedGeneration));
        if (result._tag === "Success") return result.success;

        const error = result.failure;
        const changed =
          (error instanceof SentinelError && error.reason === "topology-changed") ||
          (error instanceof ConnectionError &&
            error.delivery === "unsent" &&
            state.generation?.replacementObserved === true) ||
          (error instanceof HandshakeError &&
            error.stage === "role" &&
            error.reason === "role-mismatch");
        // Only pre-callback acquisition can move. A user workflow or application command is never repeated.
        if (
          fixedGeneration !== undefined ||
          state.entered ||
          !changed ||
          attempt + 1 === policy.discoveryAttempts
        )
          return yield* Effect.fail(error);
      }
      return yield* new SentinelError({
        reason: "data-unavailable",
        plane: "data",
        delivery: "unsent",
      });
    });

  const session = <A, E, R>(
    mode: LeaseMode,
    body: (session: ReturnType<typeof makeSession>) => Effect.Effect<A, E, R>,
  ) =>
    admission.run(
      () =>
        use(mode, false, (wire, generation) => {
          const leased = makeSession(
            wire,
            manager.sessionPolicy,
            sentinelSessionValidation(manager, generation, config.data.database),
          );
          return Effect.suspend(() => body(leased)).pipe(Effect.onExit(() => leased.finish));
        }),
      "forever",
    );
  const withSession = <A, E, R>(body: (session: RedisSession) => Effect.Effect<A, E, R>) =>
    session("session", (leased) => body(leased.client));
  const withBlockingSession = <A, E, R>(body: (session: RedisSession) => Effect.Effect<A, E, R>) =>
    session("blocking", (leased) => body(leased.client));

  return { use, session, withSession, withBlockingSession, admission };
};

export type SentinelSessions = ReturnType<typeof makeSentinelSessions>;
