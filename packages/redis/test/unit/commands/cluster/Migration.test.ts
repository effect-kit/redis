import * as Commands from "#/commands/cluster/Migration";
import { adminCases } from "#test/support/commands/AdminCase";
import {
  clusterArray as array,
  clusterInteger as integer,
  clusterOk as ok,
  clusterText as text,
} from "#test/support/commands/ClusterValues";

adminCases("cluster migration", [
  {
    command: Commands.clusterMigrationImport([[1, 2]]),
    tokens: ["CLUSTER", "MIGRATION", "IMPORT", "1", "2"],
    reply: text("task"),
    expected: "task",
  },
  {
    command: Commands.clusterMigrationCancel({ id: "task" }),
    tokens: ["CLUSTER", "MIGRATION", "CANCEL", "ID", "task"],
    reply: integer(1n),
    expected: 1n,
  },
  {
    command: Commands.clusterMigrationCancel("ALL"),
    tokens: ["CLUSTER", "MIGRATION", "CANCEL", "ALL"],
    reply: integer(0n),
    expected: 0n,
  },
  {
    command: Commands.clusterMigrationStatus(),
    tokens: ["CLUSTER", "MIGRATION", "STATUS"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterMigrationStatus({ id: "task" }),
    tokens: ["CLUSTER", "MIGRATION", "STATUS", "ID", "task"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterMigrationStatus("ALL"),
    tokens: ["CLUSTER", "MIGRATION", "STATUS", "ALL"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterMigrateSlots([
      {
        ranges: [
          [1, 2],
          [4, 5],
        ],
        node: "id",
      },
    ]),
    tokens: ["CLUSTER", "MIGRATESLOTS", "SLOTSRANGE", "1", "2", "4", "5", "NODE", "id"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clusterGetSlotMigrations(),
    tokens: ["CLUSTER", "GETSLOTMIGRATIONS"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterCancelSlotMigrations(),
    tokens: ["CLUSTER", "CANCELSLOTMIGRATIONS"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.trimSlots([[2, 3]]),
    tokens: ["TRIMSLOTS", "RANGES", "1", "2", "3"],
    reply: ok,
    expected: undefined,
  },
]);
