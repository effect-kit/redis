import { Effect, Exit } from "effect";

import { undecorate } from "#/command/reply/Scalars";
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

export const makeSentinelSessions = (
  manager: Omit<SentinelManager, "contextFor">,
  config: SentinelConfig,
  policy: SentinelPolicy,
) => {
  let nextWireId = 0;
  const identities = new WeakMap<SessionWire, number>();
  const admission = makeSentinelAdmission(policy.maxOperations, policy.operationTimeoutMillis);
  const use = <A, E, R>(
    mode: LeaseMode,
    replica: boolean,
    body: (wire: SessionWire, generation: SentinelGeneration) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const generation = yield* manager.ensure;
      const pool = yield* manager.pool(generation, manager.select(generation, replica));
      const observe = (reply: RespValue) => {
        if (rejectedRole(reply)) generation.obsolete = true;
      };
      let entered = false;
      return yield* pool
        .use(mode, (wire) => {
          entered = true;
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
                  Effect.tapError(() =>
                    Effect.sync(() => {
                      generation.obsolete = true;
                    }),
                  ),
                ),
              fence: (...args) =>
                wire.fence(...args).pipe(
                  Effect.tap((reply) => Effect.sync(() => observe(reply))),
                  Effect.tapError(() =>
                    Effect.sync(() => {
                      generation.obsolete = true;
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
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const defect = pool.fatal();
              if (defect !== undefined) manager.poison(defect);
              if (generation.obsolete || (!entered && Exit.isFailure(exit)))
                yield* manager.invalidate(generation);
            }),
          ),
        );
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
