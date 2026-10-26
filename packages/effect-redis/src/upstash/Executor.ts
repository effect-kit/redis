import { Cause, Effect, Exit, Redacted } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import { BatchError } from "#/errors/BatchError";
import { TransactionError } from "#/errors/TransactionError";
import { UpstashError } from "#/errors/UpstashError";
import { decodeBatch } from "#/sessions/batch/Decode";
import { mapBatchFailure } from "#/sessions/batch/Failure";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type {
  AnyCommand,
  BatchExecutorService,
  BatchFailure,
  BatchResults,
  PartialBatchError,
  TransactionOutcome,
} from "#/sessions/batch/Types";
import { validateHttpCommand } from "#/upstash/encoding/Request";
import { ambiguousJson } from "#/upstash/encoding/Status";
import type { UpstashHttpClient } from "#/upstash/http/Client";

export const makeHttpExecutor = (http: UpstashHttpClient): RedisExecutor => {
  const executePrepared = Effect.fnUntraced(function* <A, E, R>(command: PreparedCommand<A, E, R>) {
    yield* validateHttpCommand(command);
    const outcome = yield* http.request([command], "ordinary");
    const reply = outcome._tag === "Rejected" ? outcome.reply : outcome.replies[0];
    if (reply === undefined) return yield* Effect.die("Missing validated HTTP reply");

    return yield* decodeReply(command, reply);
  });

  return {
    executePrepared,
    execute: <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
      command.prepare.pipe(Effect.flatMap(executePrepared)),
  };
};

export const makeHttpBatches = (http: UpstashHttpClient): BatchExecutorService => {
  const execute = <const Cs extends ReadonlyArray<AnyCommand>>(
    commands: Cs,
    mode: "pipeline" | "transaction",
  ) =>
    Effect.gen(function* () {
      const prepared = yield* prepareBatch(commands, http.config.maxBatchCommands);
      for (const command of prepared) {
        yield* validateHttpCommand(command);
        if (mode === "transaction" && ambiguousJson(command))
          return yield* new UpstashError({
            stage: "request",
            reason: "encoding",
            delivery: "unsent",
          });
      }
      // The validated empty input tuple has an equally empty result tuple.
      if (prepared.length === 0) return [] as unknown as BatchResults<Cs>;

      let sent = false;
      const phase = mode === "pipeline" ? "pipeline" : "transaction-exec";
      const unknown = (error: unknown) =>
        new BatchError({
          phase,
          execution: "unknown",
          outcomes: Redacted.make(
            prepared.map((_, index) => ({
              _tag: sent ? "Unknown" : "Unsent",
              index,
              error: Redacted.make(error),
            })),
          ),
        }) as PartialBatchError<Cs>;

      // Preserve indexed evidence in interrupted/defect Causes as on native batches.
      const outcomes = yield* Effect.gen(function* () {
        sent = true;
        const result = yield* http
          .request(prepared, mode)
          .pipe(
            Effect.catch(
              (error: UpstashError): Effect.Effect<never, UpstashError | PartialBatchError<Cs>> =>
                error.delivery === "unsent" ? Effect.fail(error) : Effect.fail(unknown(error)),
            ),
          );
        if (result._tag === "Rejected") {
          if (mode === "transaction")
            return yield* new BatchError({
              phase,
              execution: "not-executed",
              outcomes: Redacted.make(
                prepared.map((_, index) => ({
                  _tag: "Unsent",
                  index,
                  error: Redacted.make(result.reply),
                })),
              ),
            });
          return yield* unknown(result.reply);
        }
        return yield* mapBatchFailure(
          decodeBatch<Cs>(
            prepared,
            result.replies.map((reply) => ({ _tag: "Replied", reply })),
            phase,
          ),
          (error) => error as PartialBatchError<Cs>,
        );
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
            ? Effect.fail(unknown(exit.cause))
            : Effect.void,
        ),
      );

      return outcomes;
    }).pipe((operation) =>
      mapBatchFailure(operation, (error) =>
        error instanceof BatchError ? (error as PartialBatchError<Cs>) : error,
      ),
    );

  return {
    pipeline: (commands) => execute(commands, "pipeline"),
    transaction: (commands) =>
      execute(commands, "transaction").pipe(
        Effect.catch(
          (error): Effect.Effect<never, BatchFailure<typeof commands> | TransactionError> =>
            error instanceof BatchError && error.execution === "not-executed"
              ? Effect.fail(
                  new TransactionError({
                    reason: "exec-rejected",
                    execution: "not-executed",
                    errors: error.outcomes,
                  }),
                )
              : Effect.fail(error),
        ),
        Effect.map((results): TransactionOutcome<typeof commands> => ({
          _tag: "Committed",
          results,
        })),
      ),
  };
};
