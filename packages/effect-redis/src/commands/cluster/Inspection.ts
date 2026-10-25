import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned, simpleText } from "#/command/reply/Data";
import { blob, mismatch } from "#/command/reply/Scalars";
import { fields, help, lossless, nodeCommand, reportText } from "#/commands/admin/Build";
import { Slot } from "#/commands/cluster/Build";
import { Argument, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const clusterInfo = () => nodeCommand("CLUSTER INFO", reportText);
export const clusterNodes = () => nodeCommand("CLUSTER NODES", reportText);
export const clusterMyId = () => nodeCommand("CLUSTER MYID", simpleText);
export const clusterMyShardId = () => nodeCommand("CLUSTER MYSHARDID", simpleText);
export const clusterHelp = () => nodeCommand("CLUSTER HELP", help);
export const clusterShards = () => nodeCommand("CLUSTER SHARDS", array(fields));
export const clusterSlots = () => nodeCommand("CLUSTER SLOTS", array(array(lossless)));
export const clusterLinks = () => nodeCommand("CLUSTER LINKS", array(fields));
export const clusterReplicas = (node: RedisArgument) =>
  nodeCommand(
    "CLUSTER REPLICAS",
    array(simpleText),
    parse(Argument, node).pipe(Effect.map((id) => [id])),
  );
export const clusterSlaves = (node: RedisArgument) =>
  nodeCommand(
    "CLUSTER SLAVES",
    array(simpleText),
    parse(Argument, node).pipe(Effect.map((id) => [id])),
  );
export const clusterCountFailureReports = (node: RedisArgument) =>
  nodeCommand(
    "CLUSTER COUNT-FAILURE-REPORTS",
    unsigned,
    parse(Argument, node).pipe(Effect.map((id) => [id])),
  );
export const clusterKeySlot = (key: RedisArgument) =>
  nodeCommand(
    "CLUSTER KEYSLOT",
    unsigned,
    parse(Argument, key).pipe(Effect.map((value) => [value])),
  );
export const clusterCountKeysInSlot = (slot: number) =>
  nodeCommand(
    "CLUSTER COUNTKEYSINSLOT",
    unsigned,
    parse(Slot, slot).pipe(Effect.map((value) => [String(value)])),
  );
export const clusterGetKeysInSlot = (slot: number, count: Integer) =>
  nodeCommand(
    "CLUSTER GETKEYSINSLOT",
    array(blob),
    Effect.gen(function* () {
      return [String(yield* parse(Slot, slot)), String(yield* parse(NonNegative, count))];
    }),
  );

const SlotStats = Schema.Union([
  Schema.Struct({
    range: Schema.Tuple([Slot, Slot]).check(Schema.makeFilter(([first, last]) => first <= last)),
  }),
  Schema.Struct({
    orderBy: Schema.NonEmptyString,
    limit: Schema.optionalKey(NonNegative),
    order: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])),
  }),
]);
export type ClusterSlotStatsOptions = typeof SlotStats.Type;

export const clusterSlotStats = (options: ClusterSlotStatsOptions) =>
  nodeCommand(
    "CLUSTER SLOT-STATS",
    array(array(lossless)),
    Effect.gen(function* () {
      const selected = yield* parse(SlotStats, options);
      return "range" in selected
        ? ["SLOTSRANGE", ...selected.range.map(String)]
        : [
            "ORDERBY",
            selected.orderBy,
            ...(selected.limit === undefined ? [] : ["LIMIT", String(selected.limit)]),
            ...(selected.order === undefined ? [] : [selected.order]),
          ];
    }),
  );

export const clusterBumpEpoch = () =>
  nodeCommand("CLUSTER BUMPEPOCH", (reply) =>
    simpleText(reply).pipe(
      Effect.flatMap((value) => {
        if (!/^(BUMPED|STILL) [0-9]+$/.test(value)) return Effect.fail(mismatch("custom", reply));
        const [state, epoch = ""] = value.split(" ");
        return Effect.succeed({
          state: state === "BUMPED" ? ("BUMPED" as const) : ("STILL" as const),
          epoch: BigInt(epoch),
        });
      }),
    ),
  );
