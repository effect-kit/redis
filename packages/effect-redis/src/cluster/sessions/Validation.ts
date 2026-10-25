import { Effect } from "effect";

import { commandSlot, sameSlot } from "#/cluster/routing/Route";
import type { Discovery } from "#/cluster/topology/Discovery";
import { primaryForSlot } from "#/cluster/topology/Types";
import type { PreparedCommand } from "#/command/Command";
import { ClusterError } from "#/errors/ClusterError";
import type { SessionValidation } from "#/sessions/Validation";

export const makeClusterSessionValidation = (
  discovery: Discovery,
  node: string,
  database: number,
  anchor?: number,
): SessionValidation => {
  let selectedSlot = anchor;
  const slot = (value: number | undefined) =>
    Effect.suspend(() => {
      if (value === undefined) return Effect.void;
      if (selectedSlot !== undefined && selectedSlot !== value)
        return Effect.fail(new ClusterError({ reason: "cross-slot", delivery: "unsent" }));
      const topology = discovery.current();
      if (topology === undefined || primaryForSlot(topology, value)?.primary.id !== node)
        return Effect.fail(new ClusterError({ reason: "session-route", delivery: "unsent" }));
      return Effect.void;
    });

  const command = Effect.fnUntraced(function* (
    prepared: PreparedCommand<unknown, unknown, unknown>,
  ) {
    if (prepared.routing._tag === "Node" && prepared.routing.node !== node)
      return yield* new ClusterError({ reason: "session-route", delivery: "unsent" });
    if (prepared.routing._tag === "Dynamic" && anchor !== undefined)
      return yield* new ClusterError({ reason: "unresolved-keys", delivery: "unsent" });
    const routed = yield* commandSlot(prepared, true);
    yield* slot(routed);
  });

  return {
    command,
    batch: Effect.fnUntraced(function* (commands, transaction) {
      for (const prepared of commands) yield* command(prepared);
      if (!transaction) return;
      const slots = yield* Effect.forEach(commands, (prepared) => commandSlot(prepared, true));
      const keys = slots.filter((value) => value !== undefined);
      if (new Set(keys).size > 1)
        return yield* new ClusterError({ reason: "cross-slot", delivery: "unsent" });
      yield* slot(keys[0]);
    }),
    watch: Effect.fnUntraced(function* (keys) {
      const value = yield* sameSlot(keys);
      yield* slot(value);
      selectedSlot = value;
    }),
    database: (value) =>
      BigInt(value) === BigInt(database)
        ? Effect.void
        : Effect.fail(new ClusterError({ reason: "database", delivery: "unsent" })),
  };
};
