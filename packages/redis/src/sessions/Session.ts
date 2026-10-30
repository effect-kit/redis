import { Effect } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import { status } from "#/command/reply/Scalars";
import { registerValuesExecutor } from "#/command/ValuesExecutor";
import { blockingFamily } from "#/commands/blocking/Family";
import { hashImportFamily } from "#/commands/hashes/Import";
import { Arguments, parse } from "#/commands/internal/Input";
import { blockingStreamFamily } from "#/commands/streams/ReadFamily";
import { blockingTimeSeriesFamily } from "#/commands/timeseries/Family";
import { clientTracking, clientTrackingInfo } from "#/commands/tracking/Controls";
import type { TrackingOptions } from "#/commands/tracking/Controls";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { SessionError } from "#/errors/SessionError";
import { makeRedis } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import { decodeBatchValues } from "#/sessions/batch/DecodeValues";
import { pipelineReplies, runPipeline } from "#/sessions/batch/Pipeline";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type { AnyCommand, PreparedBatch } from "#/sessions/batch/Types";
import { adjacencyControls } from "#/sessions/controls/Adjacency";
import { connectionControls } from "#/sessions/controls/Connection";
import { durabilityControls } from "#/sessions/controls/Durability";
import { exchange } from "#/sessions/controls/Exchange";
import { checkAdvanced, isBlocking } from "#/sessions/controls/Guard";
import { replyModeControls } from "#/sessions/controls/ReplyMode";
import type { SessionPolicy } from "#/sessions/pool/Options";
import type { SessionWire } from "#/sessions/pool/Wire";
import { runTransaction } from "#/sessions/transaction/Execute";
import { makeSessionState } from "#/sessions/transaction/State";
import type { SessionValidation } from "#/sessions/Validation";

export const makeSession = (
  wire: SessionWire,
  policy: SessionPolicy,
  validation?: SessionValidation,
) => {
  let tainted = false;
  const state = makeSessionState(wire, policy.cleanupTimeoutMillis);

  const executePrepared = <A, E, R>(command: PreparedCommand<A, E, R>) =>
    state.run(() =>
      Effect.gen(function* () {
        const mode = command.metadata.execution;
        if (validation !== undefined) yield* validation.command(command);
        if (mode === "ordinary") {
          if (checkOrdinary(command.tokens) !== undefined)
            return yield* new SessionError({ reason: "execution-mode", delivery: "unsent" });
        } else if (mode === "blocking") {
          if (!isBlocking(command.tokens))
            return yield* new SessionError({ reason: "execution-mode", delivery: "unsent" });
        } else if (mode === "exclusive" || mode === "advanced") {
          const error = checkAdvanced(command.tokens);
          if (error !== undefined) return yield* error;
          tainted = true;
        } else return yield* new SessionError({ reason: "execution-mode", delivery: "unsent" });

        if (command.routing._tag === "Node" && validation === undefined)
          return yield* new SessionError({ reason: "routing", delivery: "unsent" });

        return yield* decodeReply(
          command,
          yield* wire.execute(command.tokens, command.replyTimeoutMillis),
        );
      }),
    );
  const executor: RedisExecutor = {
    executePrepared,
    execute: <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
      command.prepare.pipe(Effect.flatMap(executePrepared)),
  };

  const transactionPrepared = <Cs extends ReadonlyArray<AnyCommand>>(prepared: PreparedBatch<Cs>) =>
    state.run(
      () =>
        (validation?.batch(prepared, true) ?? Effect.void).pipe(
          Effect.andThen(runTransaction<Cs>(wire, state, prepared)),
        ),
      true,
    );

  const pipelinePrepared = <Cs extends ReadonlyArray<AnyCommand>>(prepared: PreparedBatch<Cs>) =>
    state.run(() =>
      Effect.gen(function* () {
        if (prepared.length > policy.maxBatchCommands)
          return yield* new SessionError({ reason: "batch-limit", delivery: "unsent" });
        yield* validation?.batch(prepared, false) ?? Effect.void;
        return yield* runPipeline<Cs>(wire, prepared);
      }),
    );

  const makeClient = () => ({
    ...makeRedis(
      registerValuesExecutor({ ...executor, executeBatchPrepared: pipelinePrepared }, (prepared) =>
        state.run(() =>
          Effect.gen(function* () {
            if (prepared.length > policy.maxBatchCommands)
              return yield* new SessionError({ reason: "batch-limit", delivery: "unsent" });
            yield* validation?.batch(prepared, false) ?? Effect.void;

            return yield* decodeBatchValues(prepared, yield* pipelineReplies(wire, prepared));
          }),
        ),
      ),
    ),
    ...blockingFamily(executor),
    ...blockingTimeSeriesFamily(executor),
    ...hashImportFamily(executor),
    ...blockingStreamFamily(executor),
    ...durabilityControls(wire, state),
    ...connectionControls(
      wire,
      state,
      () => {
        tainted = true;
      },
      validation,
    ),
    ...adjacencyControls(wire, state, validation),
    ...replyModeControls(wire, state, policy, validation),
    tracking: (enabled: boolean, options?: TrackingOptions) =>
      executor.execute(clientTracking(enabled, options)),
    trackingInfo: () => executor.execute(clientTrackingInfo()),
    pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      state.run(() =>
        prepareBatch(commands, policy.maxBatchCommands).pipe(
          Effect.flatMap((prepared) =>
            (validation?.batch(prepared, false) ?? Effect.void).pipe(
              Effect.andThen(runPipeline<Cs>(wire, prepared)),
            ),
          ),
        ),
      ),
    transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      state.run(
        () =>
          prepareBatch(commands, policy.maxBatchCommands).pipe(
            Effect.flatMap((prepared) =>
              (validation?.batch(prepared, true) ?? Effect.void).pipe(
                Effect.andThen(runTransaction<Cs>(wire, state, prepared)),
              ),
            ),
          ),
        true,
      ),
    watch: (keys: readonly [RedisArgument, ...RedisArgument[]]) =>
      state.run(() =>
        Effect.gen(function* () {
          const prepared = yield* parse(Arguments, keys);
          if (validation !== undefined) yield* validation.watch(prepared);
          state.set("uncertain");
          yield* exchange(wire, ["WATCH", ...prepared], status("OK"));
          state.set("watched");
        }),
      ),
    unwatch: () =>
      state.run(() =>
        Effect.gen(function* () {
          state.set("uncertain");
          yield* exchange(wire, ["UNWATCH"], status("OK"));
          state.set("idle");
        }),
      ),
    snapshot: Effect.sync(() => ({ generation: wire.id, mode: state.get() })),
  });

  let client: ReturnType<typeof makeClient> | undefined;

  return {
    // Direct transactions need lease state, but none of the command-family closures.
    get client() {
      return (client ??= makeClient());
    },
    finish: state.finish.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (tainted) wire.retire();
        }),
      ),
    ),
    transactionPrepared,
    pipelinePrepared,
  };
};

export type RedisSession = ReturnType<typeof makeSession>["client"];
