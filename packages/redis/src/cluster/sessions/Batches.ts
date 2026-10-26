import { Effect } from "effect";

import { commandSlot } from "#/cluster/routing/Route";
import type { ClusterRouter } from "#/cluster/routing/Router";
import type { makeClusterSessions } from "#/cluster/sessions/Sessions";
import { ClusterError } from "#/errors/ClusterError";
import { prepareBatch } from "#/sessions/batch/Prepare";
import type {
  AnyCommand,
  BatchExecutorService,
  BatchResults,
  PreparedBatch,
} from "#/sessions/batch/Types";
import type { SessionPolicy } from "#/sessions/pool/Options";

export const makeClusterBatches = (
  sessions: ReturnType<typeof makeClusterSessions>,
  router: ClusterRouter,
  policy: SessionPolicy,
): BatchExecutorService => {
  const target = Effect.fnUntraced(function* (prepared: PreparedBatch<ReadonlyArray<AnyCommand>>) {
    let selected: number | undefined;
    let firstKey: (typeof prepared)[number] | undefined;
    for (const command of prepared) {
      const slot = yield* commandSlot(command, true);
      if (command.routing._tag === "Dynamic" || command.routing._tag === "Node")
        return yield* new ClusterError({ reason: "explicit-target-required", delivery: "unsent" });
      if (slot === undefined) continue;
      if (selected !== undefined && selected !== slot)
        return yield* new ClusterError({ reason: "cross-slot", delivery: "unsent" });
      selected = slot;
      firstKey = command;
    }
    if (firstKey === undefined)
      return yield* new ClusterError({ reason: "explicit-target-required", delivery: "unsent" });
    const routed = yield* router.route(firstKey, undefined, true);
    if (routed.slot === undefined)
      return yield* new ClusterError({ reason: "explicit-target-required", delivery: "unsent" });
    const command = firstKey;
    const key =
      command.routing._tag === "Keys" ? command.tokens[command.routing.keys[0].index] : undefined;
    if (key === undefined)
      return yield* new ClusterError({ reason: "explicit-target-required", delivery: "unsent" });
    return { key };
  });

  return {
    pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      Effect.gen(function* () {
        const prepared = yield* prepareBatch(commands, policy.maxBatchCommands);
        if (prepared.length === 0) return [] as BatchResults<Cs>;
        const destination = yield* target(prepared);
        // Reuse prepared descriptors; payload preparation must happen once before any write.
        return yield* sessions.use(destination, "session", (session) =>
          session.pipelinePrepared<Cs>(prepared),
        );
      }),
    transaction: <const Cs extends ReadonlyArray<AnyCommand>>(commands: Cs) =>
      Effect.gen(function* () {
        const prepared = yield* prepareBatch(commands, policy.maxBatchCommands);
        const destination = yield* target(prepared);
        return yield* sessions.use(destination, "session", (session) =>
          session.transactionPrepared<Cs>(prepared),
        );
      }),
  };
};
