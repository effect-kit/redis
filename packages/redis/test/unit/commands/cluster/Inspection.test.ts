import * as Commands from "#/commands/cluster/Inspection";
import { adminCases } from "#test/support/commands/AdminCase";
import {
  clusterArray as array,
  clusterInteger as integer,
  clusterText as text,
} from "#test/support/commands/ClusterValues";

adminCases("cluster inspection", [
  {
    command: Commands.clusterInfo(),
    tokens: ["CLUSTER", "INFO"],
    reply: text("cluster_state:ok\r\n"),
    expected: "cluster_state:ok\r\n",
  },
  {
    command: Commands.clusterNodes(),
    tokens: ["CLUSTER", "NODES"],
    reply: text("node unknown future flags"),
    expected: "node unknown future flags",
  },
  {
    command: Commands.clusterMyId(),
    tokens: ["CLUSTER", "MYID"],
    reply: text("node-id"),
    expected: "node-id",
  },
  {
    command: Commands.clusterMyShardId(),
    tokens: ["CLUSTER", "MYSHARDID"],
    reply: text("shard-id"),
    expected: "shard-id",
  },
  {
    command: Commands.clusterHelp(),
    tokens: ["CLUSTER", "HELP"],
    reply: array(text("SHARDS")),
    expected: ["SHARDS"],
  },
  {
    command: Commands.clusterShards(),
    tokens: ["CLUSTER", "SHARDS"],
    reply: array(array(text("future"), integer(9n))),
    expected: [[["future", integer(9n)]]],
  },
  {
    command: Commands.clusterSlots(),
    tokens: ["CLUSTER", "SLOTS"],
    reply: array(array(integer(0n), integer(16383n))),
    expected: [[integer(0n), integer(16383n)]],
  },
  {
    command: Commands.clusterLinks(),
    tokens: ["CLUSTER", "LINKS"],
    reply: array(array(text("future"), text("preserved"))),
    expected: [[["future", text("preserved")]]],
  },
  {
    command: Commands.clusterReplicas("node"),
    tokens: ["CLUSTER", "REPLICAS", "node"],
    reply: array(text("replica")),
    expected: ["replica"],
  },
  {
    command: Commands.clusterSlaves("node"),
    tokens: ["CLUSTER", "SLAVES", "node"],
    reply: array(text("replica")),
    expected: ["replica"],
  },
  {
    command: Commands.clusterCountFailureReports("node"),
    tokens: ["CLUSTER", "COUNT-FAILURE-REPORTS", "node"],
    reply: integer(0n),
    expected: 0n,
  },
  {
    command: Commands.clusterKeySlot("foo"),
    tokens: ["CLUSTER", "KEYSLOT", "foo"],
    reply: integer(12182n),
    expected: 12182n,
  },
  {
    command: Commands.clusterCountKeysInSlot(0),
    tokens: ["CLUSTER", "COUNTKEYSINSLOT", "0"],
    reply: integer(9007199254740993n),
    expected: 9007199254740993n,
  },
  {
    command: Commands.clusterGetKeysInSlot(16383, 2n),
    tokens: ["CLUSTER", "GETKEYSINSLOT", "16383", "2"],
    reply: array(text("key")),
    expected: [new TextEncoder().encode("key")],
  },
  {
    command: Commands.clusterSlotStats({ range: [0, 16383] }),
    tokens: ["CLUSTER", "SLOT-STATS", "SLOTSRANGE", "0", "16383"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterSlotStats({ orderBy: "key-count", limit: 2n, order: "DESC" }),
    tokens: ["CLUSTER", "SLOT-STATS", "ORDERBY", "key-count", "LIMIT", "2", "DESC"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.clusterBumpEpoch(),
    tokens: ["CLUSTER", "BUMPEPOCH"],
    reply: text("BUMPED 9007199254740993"),
    expected: { state: "BUMPED", epoch: 9007199254740993n },
  },
]);
