import { Cause, Clock, Deferred, Effect, Exit, Option, Redacted } from "effect";

import type { Admission, ExecutionError, Ticket } from "#/connection/Admission";
import type { makeDeadlines } from "#/connection/deadline/Coordinator";
import type { Generation } from "#/connection/Generation";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { AdmissionError } from "#/errors/AdmissionError";
import { BatchError } from "#/errors/BatchError";
import { ConnectionError } from "#/errors/ConnectionError";
import { ProtocolError } from "#/errors/ProtocolError";
import { TransportError } from "#/errors/TransportError";
import type { CommandPolicy } from "#/profiles/Commands";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisConfig } from "#/RedisConfig";
import { collectReplies } from "#/sessions/pool/Replies";

interface BatchOwner {
  readonly admission: Admission;
  readonly deadlines: Effect.Success<ReturnType<typeof makeDeadlines>>;
  readonly config: RedisConfig;
  readonly guard: CommandPolicy;
  readonly isClosed: () => boolean;
  readonly current: () => Generation | undefined;
  readonly ensureReady: Effect.Effect<Generation, ExecutionError | TransportError>;
}

const unavailable = () =>
  new ConnectionError({ reason: "closed", generation: 0, delivery: "unsent" });

/** Ordinary batches share the ordered connection, never a transaction/session lease. */
export const makeOrdinaryBatch = (owner: BatchOwner) =>
  Effect.fnUntraced(function* (commands: ReadonlyArray<RedisCommand>) {
    const tickets: Ticket[] = [];
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (owner.isClosed()) return yield* unavailable();
        for (const command of commands) {
          const restricted = owner.guard(command) ?? checkOrdinary(command);
          if (restricted !== undefined) return yield* restricted;
        }
        const now = yield* Clock.currentTimeMillis;
        const reserved = owner.admission.reserveBatch(
          commands,
          now,
          owner.config.commandTimeoutMillis,
        );
        if (reserved instanceof AdmissionError || reserved instanceof ProtocolError)
          return yield* reserved;
        tickets.push(...reserved);
        const replies = collectReplies(tickets);
        const enqueue = (generation: Generation) => {
          for (const ticket of tickets) if (ticket.phase !== "done") generation.enqueue(ticket);
          return replies.await;
        };
        const acquire = owner.ensureReady.pipe(
          Effect.mapError((error) =>
            error instanceof TransportError || error instanceof ProtocolError
              ? new ConnectionError({
                  reason: error instanceof ProtocolError ? "protocol" : "transport",
                  delivery: "unsent",
                  generation: 0,
                  cause: Redacted.make(error),
                })
              : error,
          ),
          Effect.flatMap(enqueue),
        );
        const operation = Effect.suspend(() => {
          const ready = owner.current();
          return ready?.isReady() ? enqueue(ready) : acquire.pipe(Effect.raceFirst(replies.await));
        });
        const expire = () => {
          for (const ticket of tickets) {
            if (ticket.phase === "done" || ticket.replied) continue;
            owner.admission.timeout(ticket);
            const error = new ConnectionError({
              reason: "timeout",
              generation: ticket.generation,
              delivery: ticket.mayHaveBeenWritten ? "possibly-written" : "unsent",
            });
            const cancel = ticket.cancel;
            // Notify before retirement so the expired slot keeps its timeout evidence.
            owner.admission.notifyFailure(ticket, error);
            cancel?.();
            owner.admission.release(ticket);
          }
        };
        const clock = yield* Clock.Clock;
        const remaining = Math.max(
          0,
          owner.config.commandTimeoutMillis + now - clock.currentTimeMillisUnsafe(),
        );
        const cancelDeadline =
          clock === owner.deadlines.clock ? owner.deadlines.schedule(remaining, expire) : undefined;
        const timed =
          clock === owner.deadlines.clock
            ? operation
            : operation.pipe(
                Effect.timeoutOrElse({
                  duration: remaining,
                  orElse: () => Effect.sync(expire).pipe(Effect.andThen(replies.await)),
                }),
              );
        return yield* restore(timed).pipe(Effect.ensuring(Effect.sync(() => cancelDeadline?.())));
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? Effect.gen(function* () {
                for (const ticket of tickets) {
                  if (ticket.phase === "done" || ticket.replied) continue;
                  if (Cause.hasInterrupts(exit.cause)) owner.admission.cancellations++;
                  ticket.cancel?.();
                  owner.admission.release(ticket);
                }
                if (!Cause.hasDies(exit.cause) && !Cause.hasInterrupts(exit.cause)) return;
                const outcomes = yield* Effect.forEach(tickets, (ticket, index) =>
                  Effect.gen(function* () {
                    const polled = yield* Deferred.poll(ticket.result);
                    const completed = Option.isSome(polled)
                      ? yield* Effect.exit(polled.value)
                      : undefined;
                    return completed !== undefined && Exit.isSuccess(completed)
                      ? { _tag: "Replied" as const, index, reply: Redacted.make(completed.value) }
                      : {
                          _tag: ticket.mayHaveBeenWritten
                            ? ("Unknown" as const)
                            : ("Unsent" as const),
                          index,
                          error: Redacted.make(exit.cause),
                        };
                  }),
                );
                return yield* new BatchError({
                  phase: "pipeline",
                  execution: "partial-or-unknown",
                  outcomes: Redacted.make(outcomes),
                });
              })
            : Effect.void,
        ),
      ),
    );
  });
