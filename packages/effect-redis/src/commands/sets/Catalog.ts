// Reviewed availability from the Redis 8.10.2 / Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  SADD: metadata("SADD", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SCARD: metadata("SCARD", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SDIFF: metadata("SDIFF", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SDIFFCARD: metadata(
    "SDIFFCARD",
    "sets",
    ["CORE-SETS"],
    ["Redis since 8.10.0", "Absent from Valkey 9.1.2 source baseline"],
  ),
  SDIFFSTORE: metadata(
    "SDIFFSTORE",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
  SINTER: metadata("SINTER", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SINTERCARD: metadata(
    "SINTERCARD",
    "sets",
    ["CORE-SETS"],
    ["Redis since 7.0.0", "Valkey since 7.0.0"],
  ),
  SINTERSTORE: metadata(
    "SINTERSTORE",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
  SISMEMBER: metadata(
    "SISMEMBER",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
  SMEMBERS: metadata(
    "SMEMBERS",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
  SMISMEMBER: metadata(
    "SMISMEMBER",
    "sets",
    ["CORE-SETS"],
    ["Redis since 6.2.0", "Valkey since 6.2.0"],
  ),
  SMOVE: metadata("SMOVE", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SPOP: metadata("SPOP", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SRANDMEMBER: metadata(
    "SRANDMEMBER",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
  SREM: metadata("SREM", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SUNION: metadata("SUNION", "sets", ["CORE-SETS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  SUNIONCARD: metadata(
    "SUNIONCARD",
    "sets",
    ["CORE-SETS"],
    ["Redis since 8.10.0", "Absent from Valkey 9.1.2 source baseline"],
  ),
  SUNIONSTORE: metadata(
    "SUNIONSTORE",
    "sets",
    ["CORE-SETS"],
    ["Redis since 1.0.0", "Valkey since 1.0.0"],
  ),
};
