import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import * as Commands from "#/commands/cluster/Management";
import { adminCases } from "#test/support/commands/AdminCase";
import { clusterOk as reply } from "#test/support/commands/ClusterValues";

adminCases("cluster management", [
  {
    command: Commands.clusterAddSlots([0, 16383]),
    tokens: ["CLUSTER", "ADDSLOTS", "0", "16383"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterDelSlots([1]),
    tokens: ["CLUSTER", "DELSLOTS", "1"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterAddSlotRanges([
      [0, 3],
      [5, 7],
    ]),
    tokens: ["CLUSTER", "ADDSLOTSRANGE", "0", "3", "5", "7"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterDelSlotRanges([[0, 0]]),
    tokens: ["CLUSTER", "DELSLOTSRANGE", "0", "0"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterFlushSlots(),
    tokens: ["CLUSTER", "FLUSHSLOTS"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterFlushSlot(4, "ASYNC"),
    tokens: ["CLUSTER", "FLUSHSLOT", "4", "ASYNC"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterForget("node"),
    tokens: ["CLUSTER", "FORGET", "node"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterReplicate("node"),
    tokens: ["CLUSTER", "REPLICATE", "node"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterSaveConfig(),
    tokens: ["CLUSTER", "SAVECONFIG"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterSetConfigEpoch(9007199254740993n),
    tokens: ["CLUSTER", "SET-CONFIG-EPOCH", "9007199254740993"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterReset("SOFT"),
    tokens: ["CLUSTER", "RESET", "SOFT"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterFailover("TAKEOVER"),
    tokens: ["CLUSTER", "FAILOVER", "TAKEOVER"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterMeet("::1", 6379, 16379),
    tokens: ["CLUSTER", "MEET", "::1", "6379", "16379"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterSetSlot(5, { mode: "STABLE" }),
    tokens: ["CLUSTER", "SETSLOT", "5", "STABLE"],
    reply,
    expected: undefined,
  },
  {
    command: Commands.clusterSetSlot(5, { mode: "NODE", node: "id" }),
    tokens: ["CLUSTER", "SETSLOT", "5", "NODE", "id"],
    reply,
    expected: undefined,
  },
]);

it.effect("rejects out-of-range slots, reversed ranges and invalid ports during preparation", () =>
  Effect.gen(function* () {
    for (const command of [
      Commands.clusterAddSlots([16384]),
      Commands.clusterDelSlotRanges([[4, 3]]),
      Commands.clusterMeet("host", 0),
    ]) {
      expect((yield* Effect.result(command.prepare))._tag).toBe("Failure");
    }
  }),
);
