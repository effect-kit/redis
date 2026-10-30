import { Deferred, Effect } from "effect";
import type { Exit } from "effect";

import type { ExecutionError, Ticket } from "#/connection/Admission";
import type { RespValue } from "#/protocol/RespValue";

/** Ready callers and batches use callbacks; only acquisition races need a per-slot waiter. */
export const awaitReply = (ticket: Ticket): Effect.Effect<RespValue, ExecutionError> =>
  Effect.suspend(() => {
    if (ticket.outcome !== undefined) return ticket.outcome;

    ticket.result ??= Deferred.makeUnsafe();
    return Deferred.await(ticket.result);
  });

export const completeReply = (ticket: Ticket, outcome: Exit.Exit<RespValue, ExecutionError>) => {
  if (ticket.outcome !== undefined) return;

  // Publish evidence before resuming a caller: retirement may run reentrantly after notification.
  ticket.outcome = outcome;
  const notify = ticket.onResult;
  ticket.onResult = undefined;

  if (ticket.result !== undefined) Deferred.doneUnsafe(ticket.result, outcome);
  notify?.(outcome, ticket);
};
