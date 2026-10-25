import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned, simpleText } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { fields, nodeCommand } from "#/commands/admin/Build";
import { rangeTokens, SlotRanges } from "#/commands/cluster/Build";
import { Argument, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const clusterMigrationImport = (ranges: SlotRanges) =>
  nodeCommand("CLUSTER MIGRATION IMPORT", simpleText, rangeTokens(ranges));
export const clusterMigrationCancel = (task: { readonly id: RedisArgument } | "ALL") =>
  nodeCommand(
    "CLUSTER MIGRATION CANCEL",
    unsigned,
    Effect.gen(function* () {
      if (task === "ALL") return ["ALL"];
      const selected = yield* parse(Schema.Struct({ id: Argument }), task);
      return ["ID", selected.id];
    }),
  );
export const clusterMigrationStatus = (task?: { readonly id: RedisArgument } | "ALL") =>
  nodeCommand(
    "CLUSTER MIGRATION STATUS",
    array(fields),
    Effect.gen(function* () {
      if (task === undefined) return [];
      if (task === "ALL") return ["ALL"];
      const selected = yield* parse(Schema.Struct({ id: Argument }), task);
      return ["ID", selected.id];
    }),
  );

const Groups = Schema.NonEmptyArray(Schema.Struct({ ranges: SlotRanges, node: Argument }));
export type ClusterMigrationGroups = typeof Groups.Type;

export const clusterMigrateSlots = (groups: ClusterMigrationGroups) =>
  nodeCommand(
    "CLUSTER MIGRATESLOTS",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(Groups, groups);
      const tokens: RedisArgument[] = [];
      for (const group of selected)
        tokens.push("SLOTSRANGE", ...(yield* rangeTokens(group.ranges)), "NODE", group.node);
      return tokens;
    }),
  );
export const clusterGetSlotMigrations = () =>
  nodeCommand("CLUSTER GETSLOTMIGRATIONS", array(fields));
export const clusterCancelSlotMigrations = () =>
  nodeCommand("CLUSTER CANCELSLOTMIGRATIONS", status("OK"));

/** Low-level post-migration cleanup, explicitly node-scoped; never inferred from a redirect. */
export const trimSlots = (ranges: SlotRanges) =>
  nodeCommand(
    "TRIMSLOTS",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(SlotRanges, ranges);
      return ["RANGES", String(selected.length), ...(yield* rangeTokens(selected))];
    }),
  );
