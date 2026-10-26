import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Result,
  Scope,
} from "effect";

import { Admission } from "#/connection/Admission";
import type { ExecutionError, Ticket } from "#/connection/Admission";
import { makeGeneration } from "#/connection/Generation";
import type { Generation, PushReply } from "#/connection/Generation";
import { handshake } from "#/connection/Handshake";
import { decodePolicy } from "#/connection/Options";
import type { ConnectionOptions } from "#/connection/Options";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { makeReplyReader } from "#/connection/ReplyReader";
import { RoleExpectation } from "#/connection/Role";
import { AdmissionError } from "#/errors/AdmissionError";
import { ConnectionError } from "#/errors/ConnectionError";
import { HandshakeError } from "#/errors/HandshakeError";
import { ProtocolError } from "#/errors/ProtocolError";
import { RedisConfigError } from "#/errors/RedisConfigError";
import { TransportError } from "#/errors/TransportError";
import { ProfileCommandPolicy } from "#/profiles/Commands";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";

type AcquisitionError = ConnectionError | HandshakeError | ProtocolError | TransportError;

export interface ConnectionSnapshot {
  readonly state: "ready" | "connecting" | "handshaking" | "failed" | "draining" | "closed";
  readonly generation: number;
  readonly protocol: "resp2" | "resp3" | undefined;
  readonly queuedCommands: number;
  readonly queuedBytes: number;
  readonly inFlightCommands: number;
  readonly inFlightBytes: number;
  readonly admitted: number;
  readonly rejected: number;
  readonly replies: number;
  readonly cancellations: number;
  readonly timeouts: number;
  readonly unknownOutcomes: number;
  readonly queueWaitMillis: number;
  readonly connectionAttempts: number;
  readonly retiredGenerations: number;
  readonly pushBytes: number;
}

export interface RedisConnection {
  /** Declares ordinary single-reply semantics. Stateful/blocking commands require later session APIs.
   * Returns lossless RESP, including server error values; never casts or automatically replays. */
  readonly executeOrdinary: (command: RedisCommand) => Effect.Effect<RespValue, ExecutionError>;
  /** One consumer at a time; unsolicited pushes carry the physical generation that received them. */
  readonly takePush: Effect.Effect<PushReply, ConnectionError>;
  readonly snapshot: Effect.Effect<ConnectionSnapshot>;
  /** Bounded drain; timeout retires pending work and reports shutdown-timeout. */
  readonly close: Effect.Effect<void, ConnectionError>;
  readonly abort: Effect.Effect<void>;
}

/** Captures transport/credential services once; workers and replacement sockets belong to Scope. */
export const makeConnection = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options?: ConnectionOptions<R>,
) {
  const transport = yield* Transport;
  const commandPolicy = yield* ProfileCommandPolicy;
  const expectedRole = yield* RoleExpectation;
  const context = yield* Effect.context<R>();

  const { credentials, ...policyInput } = options ?? {};
  const policy = yield* decodePolicy(policyInput);

  if (credentials !== undefined && config.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "connection.credentials",
      reason: "Choose fixed credentials or an Effect credential source",
    });

  // Keep captured services, but give credential resources the current physical lifetime.
  const identity = (resourceScope: Scope.Scope) =>
    credentials === undefined
      ? Effect.succeed(config.credentials)
      : credentials.pipe(Effect.provideContext(Context.add(context, Scope.Scope, resourceScope)));

  const parent = yield* Effect.scope;
  const scope = yield* Scope.fork(parent);
  const admission = new Admission(config.limits);

  let current: Generation | undefined;
  let opening: Deferred.Deferred<Generation, AcquisitionError> | undefined;
  let acquisitionDefect: Cause.Cause<never> | undefined;
  let openingPhase: "connecting" | "handshaking" = "connecting";
  let generation = 0;
  let closing = false;
  let stopped = false;
  let connectionAttempts = 0;
  let retiredGenerations = 0;
  let protocol: "resp2" | "resp3" | undefined;

  const unavailable = () =>
    new ConnectionError({
      reason: stopped || closing ? "closed" : "unavailable",
      delivery: "unsent",
      generation,
    });

  const acquire = Effect.gen(function* () {
    if (current !== undefined) yield* Deferred.await(current.closed);

    for (let attempt = 0; attempt < policy.reconnectAttempts; attempt++) {
      if (closing || stopped) return yield* unavailable();

      const resourceScope = yield* Scope.fork(scope);
      const id = ++generation;
      connectionAttempts++;
      protocol = undefined;
      openingPhase = "connecting";

      const result = yield* Effect.exit(
        Effect.gen(function* () {
          const physical = yield* transport.open(config);
          openingPhase = "handshaking";
          const reader = yield* makeReplyReader(physical, config.limits);
          const next = yield* makeGeneration(
            id,
            resourceScope,
            physical,
            reader,
            admission,
            policy,
            () => {
              retiredGenerations++;
            },
          );

          const negotiated = yield* handshake(
            physical,
            reader,
            config,
            identity(resourceScope),
            next.push,
            id,
            expectedRole,
          );

          return { next, negotiated };
        }).pipe(
          Scope.provide(resourceScope),
          Effect.timeoutOrElse({
            duration: config.connectTimeoutMillis,
            orElse: () =>
              Effect.fail(
                new HandshakeError({ delivery: "unsent", stage: "timeout", reason: "timeout" }),
              ),
          }),
        ),
      );

      if (Exit.isSuccess(result)) {
        if (closing || stopped) {
          yield* Scope.close(resourceScope, Exit.void);
          return yield* unavailable();
        }

        current = result.value.next;
        protocol = result.value.negotiated;
        yield* Effect.forkIn(
          Deferred.await(current.retired).pipe(
            Effect.andThen(Scope.close(resourceScope, Exit.void)),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                Deferred.doneUnsafe(
                  result.value.next.closed,
                  Exit.isSuccess(exit) ? Effect.void : Effect.failCause(exit.cause),
                );
              }),
            ),
            // Retirement precedes manager shutdown; cleanup must finish before another socket can open.
            Effect.uninterruptible,
          ),
          scope,
          { startImmediately: true },
        );

        yield* current.start;
        return current;
      }

      yield* Scope.close(resourceScope, Exit.void);
      if (Cause.hasDies(result.cause)) return yield* Effect.failCause(result.cause);

      const error = Cause.findError(result.cause);
      if (Result.isFailure(error)) return yield* Effect.failCause(error.failure);
      if (
        !(error.success instanceof TransportError) ||
        error.success.reason === "limit" ||
        attempt + 1 === policy.reconnectAttempts
      )
        return yield* error.success;

      yield* Effect.sleep(Math.min(60_000, policy.reconnectDelayMillis * 2 ** attempt));
    }

    return yield* unavailable();
  });

  const ensureReady = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (stopped || (closing && current?.isReady() !== true)) return yield* unavailable();

      const fatal = current?.fatal() ?? acquisitionDefect;
      if (fatal !== undefined) return yield* Effect.failCause(fatal);
      if (current?.isReady()) return current;

      // Callers share acquisition; canceling one waiter must not cancel everyone else.
      const completion = opening ?? Deferred.makeUnsafe<Generation, AcquisitionError>();
      if (opening === undefined) {
        opening = completion;
        yield* Effect.forkIn(
          acquire.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
                  acquisitionDefect = Cause.fromReasons(
                    exit.cause.reasons.filter(Cause.isDieReason),
                  );
                if (opening === completion) opening = undefined;
                Deferred.doneUnsafe(
                  completion,
                  Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause),
                );
              }),
            ),
            Effect.catchCause((cause) =>
              Cause.hasDies(cause) || Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : Effect.void,
            ),
          ),
          scope,
        );
      }

      return yield* restore(Deferred.await(completion));
    }),
  );

  const abort = Effect.uninterruptible(
    Effect.gen(function* () {
      closing = true;
      stopped = true;
      current?.retire("aborted");
      for (const ticket of admission.tickets) admission.fail(ticket, unavailable());
      if (opening !== undefined) Deferred.doneUnsafe(opening, Effect.fail(unavailable()));

      yield* Scope.close(scope, Exit.void);
      if (current !== undefined) {
        const completed = yield* Deferred.poll(current.closed);
        if (Option.isSome(completed)) yield* completed.value;
      }
    }),
  );

  yield* Effect.addFinalizer(() => abort);

  const cancel = (ticket: Ticket, counted = true) =>
    Effect.sync(() => {
      if (ticket.phase === "done" || ticket.replied) return;
      if (counted) admission.cancellations++;
      ticket.cancel?.();
      admission.release(ticket);
    });

  const executeOrdinary = (command: RedisCommand) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const ticket = yield* Effect.suspend((): Effect.Effect<Ticket, ExecutionError> => {
          if (closing || stopped) return Effect.fail(unavailable());

          const restricted = commandPolicy(command);
          if (restricted !== undefined) return Effect.fail(restricted);

          const modeError = checkOrdinary(command);
          if (modeError !== undefined) return Effect.fail(modeError);

          const reserved = admission.reserve(command, now, config.commandTimeoutMillis);
          return reserved instanceof AdmissionError || reserved instanceof ProtocolError
            ? Effect.fail(reserved)
            : Effect.succeed(reserved);
        });

        const operation = Effect.gen(function* () {
          const ready = yield* ensureReady.pipe(
            Effect.mapError((error) =>
              error instanceof TransportError || error instanceof ProtocolError
                ? new ConnectionError({
                    reason: error instanceof ProtocolError ? "protocol" : "transport",
                    delivery: "unsent",
                    generation,
                    cause: Redacted.make(error),
                  })
                : error,
            ),
          );

          // A failed acquisition never owns a remote reply slot.
          ready.enqueue(ticket);
          return yield* Deferred.await(ticket.result);
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? cancel(ticket, Cause.hasInterrupts(exit.cause)) : Effect.void,
          ),
        );

        const remaining = config.commandTimeoutMillis - (yield* Clock.currentTimeMillis) + now;
        if (remaining <= 0) {
          admission.timeout(ticket);
          yield* cancel(ticket);
          return yield* new ConnectionError({
            reason: "timeout",
            generation: ticket.generation,
            delivery: "unsent",
          });
        }

        return yield* restore(
          operation.pipe(
            Effect.timeoutOrElse({
              duration: remaining,
              orElse: () => {
                admission.timeout(ticket);
                return Effect.fail(
                  new ConnectionError({
                    reason: "timeout",
                    generation: ticket.generation,
                    delivery: ticket.mayHaveBeenWritten ? "possibly-written" : "unsent",
                  }),
                );
              },
            }),
          ),
        );
      }),
    );

  const close = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      closing = true;

      if (admission.tickets.size !== 0)
        yield* restore(
          Deferred.await(admission.drained).pipe(
            Effect.timeoutOrElse({
              duration: policy.shutdownTimeoutMillis,
              orElse: () =>
                Effect.fail(
                  new ConnectionError({
                    reason: "shutdown-timeout",
                    delivery: "unsent",
                    generation,
                  }),
                ),
            }),
          ),
        );
    }).pipe(Effect.ensuring(abort)),
  );

  const snapshot: Effect.Effect<ConnectionSnapshot> = Effect.sync(() => ({
    state: stopped
      ? "closed"
      : closing
        ? "draining"
        : current?.isReady()
          ? "ready"
          : opening !== undefined
            ? openingPhase
            : "failed",
    generation,
    protocol,
    queuedCommands: admission.queuedCommands,
    queuedBytes: admission.queuedBytes,
    inFlightCommands: admission.inFlightCommands,
    inFlightBytes: admission.inFlightBytes,
    admitted: admission.admitted,
    rejected: admission.rejected,
    replies: admission.replies,
    cancellations: admission.cancellations,
    timeouts: admission.timeouts,
    unknownOutcomes: admission.unknownOutcomes,
    queueWaitMillis: admission.queueWaitMillis,
    connectionAttempts,
    retiredGenerations,
    pushBytes: current?.pushBytes() ?? 0,
  }));

  const takePush = Effect.suspend(() => {
    if (stopped) return Effect.fail(unavailable());

    const fatal = current?.fatal() ?? acquisitionDefect;
    if (fatal !== undefined) return Effect.failCause(fatal);

    return current?.isReady() ? current.takePush : Effect.fail(current?.failure() ?? unavailable());
  });

  yield* ensureReady.pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? abort : Effect.void)));

  return { executeOrdinary, takePush, snapshot, close, abort } satisfies RedisConnection;
});

export class Connection extends Context.Service<Connection, RedisConnection>()(
  "effect-redis/connection/Connection",
) {
  static layer<R = never>(config: RedisConfig, options?: ConnectionOptions<R>) {
    return Layer.effect(Connection, makeConnection(config, options));
  }
}
