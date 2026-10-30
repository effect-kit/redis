import { Cause, Deferred, Effect, Exit, Result } from "effect";

import type { ExecutionError, Ticket } from "#/connection/Admission";
import type { RespValue } from "#/protocol/RespValue";
import type { WireOutcome } from "#/sessions/pool/Wire";

/** One waiter per explicit batch; individual slots still retain their own failure evidence. */
export const collectReplies = (tickets: ReadonlyArray<Ticket>) => {
  const completed = Deferred.makeUnsafe<ReadonlyArray<WireOutcome>, ExecutionError>();
  const outcomes: WireOutcome[] = [];
  let remaining = tickets.length;
  let failed = false;

  if (remaining === 0) Deferred.doneUnsafe(completed, Effect.succeed(outcomes));
  const onResult = (exit: Exit.Exit<RespValue, ExecutionError>, ticket: Ticket) => {
    const index = ticket.batchIndex;
    remaining--;
    if (Exit.isSuccess(exit)) outcomes[index] = { _tag: "Replied", reply: exit.value };
    else {
      const error = Cause.findError(exit.cause);
      if (Cause.hasDies(exit.cause) || Cause.hasInterrupts(exit.cause) || Result.isFailure(error)) {
        failed = true;
        Deferred.doneUnsafe(completed, Effect.failCause(exit.cause));
        return;
      }
      outcomes[index] = {
        _tag: ticket.mayHaveBeenWritten ? "Unknown" : "Unsent",
        error: error.success,
      };
    }

    if (remaining === 0 && !failed) Deferred.doneUnsafe(completed, Effect.succeed(outcomes));
  };

  tickets.forEach((ticket, index) => {
    ticket.batchIndex = index;
    ticket.onResult = onResult;
  });

  return { await: Deferred.await(completed), isComplete: () => remaining === 0 };
};
