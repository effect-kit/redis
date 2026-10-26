// Reviewed availability from the Redis 8.10.2 / Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  PFADD: metadata(
    "PFADD",
    "hyperloglog",
    ["CORE-HYPERLOGLOG"],
    ["Redis since 2.8.9", "Valkey since 2.8.9"],
  ),
  PFCOUNT: metadata(
    "PFCOUNT",
    "hyperloglog",
    ["CORE-HYPERLOGLOG"],
    ["Redis since 2.8.9", "Valkey since 2.8.9"],
  ),
  PFMERGE: metadata(
    "PFMERGE",
    "hyperloglog",
    ["CORE-HYPERLOGLOG"],
    ["Redis since 2.8.9", "Valkey since 2.8.9"],
  ),
};
