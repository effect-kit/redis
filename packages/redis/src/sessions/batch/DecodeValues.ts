import { Cause, Effect, Exit, Redacted, Result } from "effect";

import { decodeReply } from "#/command/Decode";
import { BatchError } from "#/errors/BatchError";
import type {
  AnyCommand,
  BatchOutcomes,
  BatchValues,
  PartialBatchError,
  PreparedBatch,
} from "#/sessions/batch/Types";
import type { WireOutcome } from "#/sessions/pool/Wire";

/** Successful values occupy their final tuple; Result wrappers exist only in error evidence. */
export const decodeBatchValues = <Cs extends ReadonlyArray<AnyCommand>>(
  prepared: PreparedBatch<Cs>,
  replies: ReadonlyArray<WireOutcome>,
) =>
  Effect.suspend(() => {
    const values: unknown[] = [];
    let failures: Map<number, unknown> | undefined;
    let current = 0;
    let finishedThrough = -1;
    const execution = replies.every((reply) => reply._tag === "Replied")
      ? "replied"
      : "partial-or-unknown";

    const failure = () =>
      new BatchError({
        phase: "pipeline",
        execution,
        outcomes: Redacted.make(
          replies.map((reply, index) => {
            if (reply._tag !== "Replied")
              return { _tag: reply._tag, index, error: Redacted.make(reply.error) };
            if (index > finishedThrough)
              return { _tag: "Replied" as const, index, reply: Redacted.make(reply.reply) };

            return {
              _tag: "Completed" as const,
              index,
              result: failures?.has(index)
                ? Result.fail(failures.get(index))
                : Result.succeed(values[index]),
            };
          }) as BatchOutcomes<Cs>,
        ),
      }) as PartialBatchError<Cs>;

    const handlers = {
      onSuccess: (value: unknown) => {
        values[current] = value;
      },
      onFailure: (error: unknown) => {
        failures ??= new Map();
        failures.set(current, error);
      },
    };

    return Effect.gen(function* () {
      for (; current < replies.length; current++) {
        const reply = replies[current];
        const command = prepared[current];
        if (reply === undefined || command === undefined)
          return yield* Effect.die(new Error("Missing prepared batch slot"));
        if (reply._tag !== "Replied") continue;

        // Typed slot failures do not skip later decoders or their service requirements.
        yield* Effect.match(decodeReply(command, reply.reply), handlers);
        finishedThrough = current;
      }

      if (execution !== "replied" || failures !== undefined) return yield* Effect.fail(failure());
      return values as BatchValues<Cs>;
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause))
          ? Effect.fail(failure())
          : Effect.void,
      ),
    );
  });
