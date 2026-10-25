import { Cause, Clock, Deferred, Effect, Exit, Option, Redacted, Scope } from "effect";

import { Admission } from "#/connection/Admission";
import type { ExecutionError, Ticket } from "#/connection/Admission";
import { makeGeneration } from "#/connection/Generation";
import { handshake } from "#/connection/Handshake";
import type { ConnectionPolicy } from "#/connection/Options";
import type { ConnectionOptions } from "#/connection/Options";
import { makeReplyReader } from "#/connection/ReplyReader";
import { AdmissionError } from "#/errors/AdmissionError";
import { BatchError } from "#/errors/BatchError";
import { ConnectionError } from "#/errors/ConnectionError";
import { HandshakeError } from "#/errors/HandshakeError";
import { ProtocolError } from "#/errors/ProtocolError";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";

export type WireOutcome =
  | { readonly _tag: "Replied"; readonly reply: RespValue }
  | { readonly _tag: "Unsent" | "Unknown"; readonly error: ExecutionError };

export const makeSessionWire = Effect.fnUntraced(function* <R>(
  id: number,
  scope: Scope.Closeable,
  config: RedisConfig,
  options: ConnectionOptions<R>,
  policy: ConnectionPolicy,
) {
  const { credentials } = options;
  const transport = yield* Transport;
  const admission = new Admission(config.limits);

  const physical = yield* transport.open(config);
  const reader = yield* makeReplyReader(physical, config.limits);
  const generation = yield* makeGeneration(
    id,
    scope,
    physical,
    reader,
    admission,
    policy,
    () => {},
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => generation.retire("aborted")));

  if (credentials !== undefined && config.credentials !== undefined)
    return yield* new HandshakeError({
      delivery: "unsent",
      stage: "credentials",
      reason: "rejected",
    });

  yield* handshake(
    physical,
    reader,
    config,
    credentials ?? Effect.succeed(config.credentials),
    generation.push,
    id,
  ).pipe(
    Effect.timeoutOrElse({
      duration: config.connectTimeoutMillis,
      orElse: () =>
        Effect.fail(
          new HandshakeError({ delivery: "unsent", stage: "timeout", reason: "timeout" }),
        ),
    }),
  );
  yield* generation.start;

  const unavailable = () =>
    new ConnectionError({ reason: "closed", generation: id, delivery: "unsent" });

  const batch = Effect.fnUntraced(function* (
    commands: ReadonlyArray<RedisCommand>,
    replyTimeoutMillis: number | "forever" = config.commandTimeoutMillis,
    phase: "pipeline" | "transaction-queue" | "single" = "pipeline",
    fenced = false,
    observeFailure?: (mayHaveBeenWritten: boolean) => void,
  ) {
    const tickets: Ticket[] = [];

    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!generation.isReady()) return yield* generation.failure() ?? unavailable();
        const now = yield* Clock.currentTimeMillis;

        // Reserve the entire batch before making any frame visible to the writer.
        for (const command of fenced ? [commands[0]] : commands) {
          if (command === undefined) return yield* Effect.die(new Error("Empty fenced exchange"));
          const reserved = fenced
            ? admission.reserveExchange(commands, now, config.commandTimeoutMillis)
            : admission.reserve(command, now, config.commandTimeoutMillis);
          if (reserved instanceof AdmissionError || reserved instanceof ProtocolError) {
            for (const ticket of tickets) admission.release(ticket);
            return yield* reserved;
          }
          tickets.push(reserved);
        }

        for (const ticket of tickets) generation.enqueue(ticket);

        const receive = Effect.forEach(
          tickets,
          (ticket) =>
            Deferred.await(ticket.result).pipe(
              Effect.map((reply): WireOutcome => ({ _tag: "Replied", reply })),
              Effect.catch((error) =>
                Effect.succeed<WireOutcome>({
                  _tag: ticket.mayHaveBeenWritten ? "Unknown" : "Unsent",
                  error,
                }),
              ),
            ),
          { concurrency: "unbounded" },
        );

        const timed =
          replyTimeoutMillis === "forever"
            ? receive
            : receive.pipe(
                Effect.timeoutOrElse({
                  duration: replyTimeoutMillis,
                  orElse: () =>
                    Effect.sync(() => generation.retire("timeout")).pipe(Effect.andThen(receive)),
                }),
              );

        return yield* restore(timed).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.gen(function* () {
                  observeFailure?.(tickets.some((ticket) => ticket.mayHaveBeenWritten));
                  // An interrupted reader cannot release possibly-written FIFO slots for reuse.
                  generation.retire(
                    "aborted",
                    undefined,
                    Cause.hasDies(exit.cause)
                      ? Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason))
                      : undefined,
                  );
                  if (phase === "single") return;

                  const outcomes = yield* Effect.forEach(tickets, (ticket, index) =>
                    Effect.gen(function* () {
                      const polled = yield* Deferred.poll(ticket.result);
                      const completed = Option.isSome(polled)
                        ? yield* Effect.exit(polled.value)
                        : undefined;
                      return completed !== undefined && Exit.isSuccess(completed)
                        ? { _tag: "Replied", index, reply: Redacted.make(completed.value) }
                        : {
                            _tag: ticket.mayHaveBeenWritten ? "Unknown" : "Unsent",
                            index,
                            error: Redacted.make(
                              completed !== undefined && Exit.isFailure(completed)
                                ? completed.cause
                                : exit.cause,
                            ),
                          };
                    }),
                  );

                  // Add evidence to the Cause while retaining its original interruption/defect.
                  return yield* new BatchError({
                    phase,
                    execution:
                      phase === "transaction-queue" ? "not-executed" : "partial-or-unknown",
                    outcomes: Redacted.make(outcomes),
                  });
                })
              : Effect.void,
          ),
        );
      }),
    );
  });

  const execute = Effect.fnUntraced(function* (
    command: RedisCommand,
    timeout?: number | "forever",
    observeFailure?: (mayHaveBeenWritten: boolean) => void,
  ) {
    // Single exchanges never install the batch-evidence finalizer.
    const [outcome] = yield* batch(
      [command],
      timeout,
      "single",
      false,
      observeFailure,
    ) as Effect.Effect<ReadonlyArray<WireOutcome>, ExecutionError>;
    if (outcome === undefined) return yield* Effect.die(new Error("Missing session reply slot"));
    return outcome._tag === "Replied" ? outcome.reply : yield* outcome.error;
  });

  const fence = Effect.fnUntraced(function* (commands: ReadonlyArray<RedisCommand>) {
    const [outcome] = yield* batch(
      commands,
      config.commandTimeoutMillis,
      "single",
      true,
    ) as Effect.Effect<ReadonlyArray<WireOutcome>, ExecutionError>;
    if (outcome === undefined) return yield* Effect.die(new Error("Missing fenced reply"));
    return outcome._tag === "Replied" ? outcome.reply : yield* outcome.error;
  });

  return {
    fence,
    id,
    batch,
    execute,
    isReady: generation.isReady,
    fatal: generation.fatal,
    retire: () => generation.retire("aborted"),
    drain: Effect.suspend(() => Deferred.await(admission.drained)),
    pending: () => admission.tickets.size,
    close: Effect.sync(() => generation.retire("aborted")).pipe(
      Effect.andThen(Scope.close(scope, Exit.void)),
    ),
    takePush: generation.takePush,
  };
});

export type SessionWire = Effect.Success<ReturnType<typeof makeSessionWire>>;
