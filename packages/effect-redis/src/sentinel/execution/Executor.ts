import { Effect } from "effect";

import type { PreparedCommand } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import { checkOrdinary, commandToken } from "#/connection/OrdinaryCommand";
import { SentinelError } from "#/errors/SentinelError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";
import type { SentinelSessions } from "#/sentinel/execution/Sessions";
import { replicaEligible } from "#/sentinel/execution/Validation";
import type { SentinelGeneration } from "#/sentinel/generation/Types";
import type { SentinelPolicy } from "#/sentinel/Options";
import { isBlocking } from "#/sessions/controls/Guard";

export const makeSentinelExecutor = (
  sessions: SentinelSessions,
  policy: SentinelPolicy,
  blocking = false,
  generation?: SentinelGeneration,
): RedisExecutor => {
  const reply = <A, E, R>(command: PreparedCommand<A, E, R>) => {
    const deadline =
      command.replyTimeoutMillis === "forever"
        ? "forever"
        : Math.max(policy.operationTimeoutMillis, command.replyTimeoutMillis ?? 0);
    return sessions.admission.run(
      (writing) =>
        Effect.gen(function* () {
          if (
            blocking
              ? command.metadata.execution !== "blocking" || !isBlocking(command.tokens)
              : command.metadata.execution !== "ordinary"
          )
            return yield* new UnsupportedCommandError({
              delivery: "unsent",
              reason: "execution-mode",
            });
          if (command.routing._tag === "Node" || commandToken(command.tokens[0]) === "SENTINEL")
            return yield* new SentinelError({
              reason: "routing",
              plane: "data",
              delivery: "unsent",
            });
          if (!blocking) {
            const forbidden = checkOrdinary(command.tokens);
            if (forbidden !== undefined) return yield* forbidden;
          }
          return yield* sessions.use(
            blocking ? "blocking" : "session",
            !blocking &&
              generation === undefined &&
              policy.readPreference === "replica-preferred" &&
              replicaEligible(command),
            (wire) => {
              writing();
              return wire.execute(command.tokens, command.replyTimeoutMillis);
            },
            generation,
          );
        }),
      deadline,
    );
  };

  const executor: RedisExecutor = {
    executePrepared: (command) =>
      reply(command).pipe(Effect.flatMap((received) => decodeReply(command, received))),
    execute: (command) =>
      command.prepare.pipe(Effect.flatMap((prepared) => executor.executePrepared(prepared))),
  };
  return executor;
};
