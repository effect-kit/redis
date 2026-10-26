import { Cause, Effect, Exit, Redacted } from "effect";

import { decodeReply } from "#/command/Decode";
import { BatchError } from "#/errors/BatchError";
import type {
  AnyCommand,
  BatchOutcomes,
  BatchResults,
  PartialBatchError,
  PreparedBatch,
} from "#/sessions/batch/Types";
import type { WireOutcome } from "#/sessions/pool/Wire";

/** Codec work stays outside the shared reader; cancellation retains received raw replies. */
export const decodeBatch = <Cs extends ReadonlyArray<AnyCommand>>(
  prepared: PreparedBatch<Cs>,
  replies: ReadonlyArray<WireOutcome>,
  phase: BatchError["phase"],
) =>
  Effect.suspend(() => {
    const partial = replies.map((reply, index) =>
      reply._tag === "Replied"
        ? { _tag: "Replied" as const, index, reply: Redacted.make(reply.reply) }
        : { _tag: reply._tag, index, error: Redacted.make(reply.error) },
    );
    const outcomes: Array<BatchOutcomes<ReadonlyArray<AnyCommand>>[number]> = [...partial];
    const execution = replies.every((reply) => reply._tag === "Replied")
      ? "replied"
      : "partial-or-unknown";
    const failure = () =>
      new BatchError({
        phase,
        execution,
        outcomes: Redacted.make(outcomes.slice()),
      }) as PartialBatchError<Cs>;

    return Effect.gen(function* () {
      const results = [];
      for (const [index, reply] of replies.entries()) {
        const command = prepared[index];
        if (command === undefined)
          return yield* Effect.die(new Error("Missing prepared batch slot"));
        if (reply._tag !== "Replied") continue;

        const result = yield* Effect.result(decodeReply(command, reply.reply));
        outcomes[index] = { _tag: "Completed", index, result };
        results.push(result);
      }

      if (execution !== "replied") return yield* Effect.fail(failure());

      // The prepared descriptors and wire outcomes have the input tuple's exact order and length.
      return results as BatchResults<Cs>;
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
          ? Effect.fail(failure())
          : Effect.void,
      ),
    );
  });
