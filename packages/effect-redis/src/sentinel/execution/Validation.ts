import { Effect } from "effect";

import type { PreparedCommand } from "#/command/Command";
import { commandToken } from "#/connection/OrdinaryCommand";
import { SentinelError } from "#/errors/SentinelError";
import type { SentinelManager } from "#/sentinel/generation/Manager";
import type { SentinelGeneration } from "#/sentinel/generation/Types";
import type { SessionValidation } from "#/sessions/Validation";

export const replicaEligible = (command: PreparedCommand<unknown, unknown, unknown>) =>
  command.metadata.execution === "ordinary" &&
  command.metadata.family !== "scripting" &&
  command.routing._tag === "Keys" &&
  command.routing.keys.every((key) => key.access === "read");

export const sentinelSessionValidation = (
  manager: Pick<SentinelManager, "check">,
  generation: SentinelGeneration,
  database: number,
): SessionValidation => ({
  command: (intent) =>
    manager
      .check(generation)
      .pipe(
        Effect.andThen(
          intent.routing._tag === "Node" || commandToken(intent.tokens[0]) === "SENTINEL"
            ? Effect.fail(
                new SentinelError({ reason: "routing", plane: "data", delivery: "unsent" }),
              )
            : Effect.void,
        ),
      ),
  batch: (commands) =>
    Effect.forEach(
      commands,
      (intent) => sentinelSessionValidation(manager, generation, database).command(intent),
      { discard: true },
    ),
  watch: () => manager.check(generation),
  database: (selected) =>
    manager
      .check(generation)
      .pipe(
        Effect.andThen(
          BigInt(selected) === BigInt(database)
            ? Effect.void
            : Effect.fail(
                new SentinelError({ reason: "routing", plane: "data", delivery: "unsent" }),
              ),
        ),
      ),
});
