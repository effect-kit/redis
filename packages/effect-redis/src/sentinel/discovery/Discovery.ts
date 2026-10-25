import { Cause, Deferred, Effect, Exit, Option } from "effect";

import type { Command } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { RedisError } from "#/command/Executor";
import * as Commands from "#/commands/sentinel/Discovery";
import type { SentinelAddress } from "#/commands/sentinel/Discovery";
import { makeConnection } from "#/connection/Connection";
import { RoleExpectation } from "#/connection/Role";
import { SentinelError } from "#/errors/SentinelError";
import type { RedisConfig } from "#/RedisConfig";
import type { SentinelConfig } from "#/sentinel/Config";
import { addressIdentity, connectionConfig, reportedAddress } from "#/sentinel/discovery/Address";
import { discoveryFailure } from "#/sentinel/discovery/Errors";
import type { SentinelOptions, SentinelPolicy } from "#/sentinel/Options";
import type { Transport } from "#/transport/Transport";

export interface SentinelView {
  readonly primary: SentinelAddress;
  readonly replicas: ReadonlyArray<SentinelAddress>;
}

/** A query coordinator owns its worker independently of any one cancelled waiter. */
export const makeSentinelDiscovery = Effect.fnUntraced(function* <R>(
  config: SentinelConfig,
  policy: SentinelPolicy,
  options: SentinelOptions<R>,
) {
  const context = yield* Effect.context<R | Transport>();
  const scope = yield* Effect.scope;
  const endpoints = [...config.sentinels];
  let preferred = 0;
  let pending: Deferred.Deferred<SentinelView, RedisError> | undefined;
  let waiters = 0;
  let failures = 0;
  let fatal: Cause.Cause<never> | undefined;

  const query = Effect.fnUntraced(function* (endpoint: RedisConfig) {
    if (endpoint.endpoint._tag !== "Tcp")
      return yield* new SentinelError({
        reason: "invalid-reply",
        plane: "sentinel",
        delivery: "unsent",
      });
    const mapped = yield* connectionConfig(
      endpoint,
      endpoint.endpoint,
      "sentinel",
      policy,
      options,
    );
    const connection = yield* makeConnection(
      { ...mapped, connectTimeoutMillis: policy.sentinelTimeoutMillis },
      {
        ...options.sentinelConnection,
        reconnectAttempts: 1,
      },
    );
    const execute = <A>(command: Command<A>) =>
      command.prepare.pipe(
        Effect.flatMap((intent) =>
          connection
            .executeOrdinary(intent.tokens)
            .pipe(Effect.flatMap((reply) => decodeReply(intent, reply))),
        ),
      );
    const primary = yield* execute(Commands.sentinelGetMasterAddrByName(config.serviceName));
    if (Option.isNone(primary))
      return yield* new SentinelError({
        reason: "unknown-service",
        plane: "sentinel",
        delivery: "replied",
      });

    const replicas: SentinelAddress[] = [];
    if (policy.readPreference === "replica-preferred") {
      const reports = yield* execute(Commands.sentinelReplicas(config.serviceName));
      if (reports.length + 1 > policy.maxDataNodes)
        return yield* new SentinelError({
          reason: "capacity",
          plane: "sentinel",
          delivery: "replied",
        });
      for (const fields of reports) {
        const reported = yield* reportedAddress(fields);
        if (
          reported.available &&
          addressIdentity(reported.address) !== addressIdentity(primary.value)
        )
          replicas.push(Object.freeze(reported.address));
      }
    }

    if (policy.learnSentinels) {
      for (const fields of yield* execute(Commands.sentinelSentinels(config.serviceName))) {
        const reported = yield* reportedAddress(fields);
        if (
          !reported.available ||
          endpoints.some(
            (entry) =>
              entry.endpoint._tag === "Tcp" &&
              addressIdentity(entry.endpoint) === addressIdentity(reported.address),
          )
        )
          continue;
        if (endpoints.length >= policy.maxSentinels) break;
        // Learned addresses retain the discovery identity/credentials, never the data credentials.
        endpoints.push({
          ...endpoint,
          endpoint: {
            _tag: "Tcp",
            ...reported.address,
            ...(endpoint.endpoint.tls === undefined ? {} : { tls: endpoint.endpoint.tls }),
          },
        });
      }
    }
    return Object.freeze({
      primary: Object.freeze(primary.value),
      replicas: Object.freeze(replicas),
    });
  });

  const discover = Effect.gen(function* () {
    let last: RedisError = new SentinelError({
      reason: "unreachable",
      plane: "sentinel",
      delivery: "unsent",
    });
    for (let attempt = 0; attempt < policy.discoveryAttempts; attempt++) {
      const size = endpoints.length;
      for (let offset = 0; offset < size; offset++) {
        const index = (preferred + offset) % size;
        const endpoint = endpoints[index];
        if (endpoint === undefined) continue;
        const answer = yield* Effect.result(
          Effect.scoped(
            query(endpoint).pipe(
              Effect.tap((view) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    const mapped = yield* connectionConfig(
                      config.data,
                      view.primary,
                      "data",
                      policy,
                      options,
                    );
                    const probe = yield* makeConnection(mapped, {
                      ...options.connection,
                      reconnectAttempts: 1,
                    }).pipe(Effect.provideService(RoleExpectation, "primary"));
                    yield* probe.abort;
                  }),
                ).pipe(Effect.mapError((error) => discoveryFailure("data", error))),
              ),
            ),
          ).pipe(
            Effect.provideContext(context),
            Effect.provideService(RoleExpectation, undefined),
            Effect.timeoutOrElse({
              duration: policy.sentinelTimeoutMillis,
              orElse: () =>
                Effect.fail(
                  new SentinelError({ reason: "timeout", plane: "sentinel", delivery: "unsent" }),
                ),
            }),
            Effect.mapError((error) => discoveryFailure("sentinel", error)),
          ),
        );
        if (answer._tag === "Success") {
          preferred = index;
          return answer.success;
        }
        last = answer.failure;
        if (last.reason === "authentication" || last.reason === "capacity") return yield* last;
      }
      if (attempt + 1 < policy.discoveryAttempts) yield* Effect.sleep(policy.retryDelayMillis);
    }
    return yield* last;
  });

  const lookup = Effect.acquireUseRelease(
    Effect.suspend(() => {
      if (fatal !== undefined) return Effect.failCause(fatal);
      if (waiters >= policy.maxOperations)
        return Effect.fail(
          new SentinelError({ reason: "capacity", plane: "sentinel", delivery: "unsent" }),
        );
      waiters++;
      return Effect.void;
    }),
    () =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const receipt = pending ?? Deferred.makeUnsafe<SentinelView, RedisError>();
          if (pending === undefined) {
            pending = receipt;
            yield* Effect.forkIn(
              discover.pipe(
                Effect.timeoutOrElse({
                  duration: policy.discoveryTimeoutMillis,
                  orElse: () =>
                    Effect.fail(
                      new SentinelError({
                        reason: "timeout",
                        plane: "sentinel",
                        delivery: "unsent",
                      }),
                    ),
                }),
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    if (Exit.isFailure(exit)) {
                      failures++;
                      if (Cause.hasDies(exit.cause))
                        fatal = Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason));
                    }
                    pending = undefined;
                    Deferred.doneUnsafe(receipt, exit);
                  }),
                ),
                Effect.catchCause(() => Effect.void),
              ),
              scope,
            );
          }
          return yield* restore(Deferred.await(receipt));
        }),
      ),
    () =>
      Effect.sync(() => {
        waiters--;
      }),
  );

  return {
    lookup,
    snapshot: () => ({
      discoveryWaiters: waiters,
      discoveryFailures: failures,
      sentinels: endpoints.length,
    }),
  };
});

export type SentinelDiscovery = Effect.Success<ReturnType<typeof makeSentinelDiscovery>>;
