import { Effect } from "effect";

import { checkOrdinary } from "#/connection/OrdinaryCommand";
import type { CommandInputError } from "#/errors/CommandInputError";
import { SessionError } from "#/errors/SessionError";
import type {
  AnyCommand,
  CommandFailure,
  PreparedBatch,
  PrepareRequirements,
} from "#/sessions/batch/Types";

export const prepareBatch = <const Cs extends ReadonlyArray<AnyCommand>>(
  commands: Cs,
  maximum: number,
): Effect.Effect<
  PreparedBatch<Cs>,
  CommandInputError | SessionError | CommandFailure<Cs[number]>,
  PrepareRequirements<Cs[number]>
> =>
  Effect.gen(function* () {
    if (!Array.isArray(commands) || commands.length > maximum)
      return yield* new SessionError({ reason: "batch-limit", delivery: "unsent" });

    const input: ReadonlyArray<AnyCommand> = commands;
    const prepared = yield* Effect.forEach(input, (command) => command.prepare);
    for (const command of prepared) {
      if (command.metadata.execution !== "ordinary" || checkOrdinary(command.tokens) !== undefined)
        return yield* new SessionError({ reason: "execution-mode", delivery: "unsent" });
      if (command.routing._tag === "Node")
        return yield* new SessionError({ reason: "routing", delivery: "unsent" });
    }

    return prepared;
  }) as Effect.Effect<
    PreparedBatch<Cs>,
    CommandInputError | SessionError | CommandFailure<Cs[number]>,
    PrepareRequirements<Cs[number]>
  >;
