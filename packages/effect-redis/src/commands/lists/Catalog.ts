// Reviewed availability from the Redis 8.10.2 / Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  LINDEX: metadata("LINDEX", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LINSERT: metadata(
    "LINSERT",
    "lists",
    ["CORE-LISTS"],
    ["Redis since 2.2.0", "Valkey since 2.2.0"],
  ),
  LLEN: metadata("LLEN", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LMOVE: metadata("LMOVE", "lists", ["CORE-LISTS"], ["Redis since 6.2.0", "Valkey since 6.2.0"]),
  LMOVEM: metadata(
    "LMOVEM",
    "lists",
    ["CORE-LISTS"],
    ["Redis since 8.10.0", "Absent from Valkey 9.1.2 source baseline"],
  ),
  LMPOP: metadata("LMPOP", "lists", ["CORE-LISTS"], ["Redis since 7.0.0", "Valkey since 7.0.0"]),
  LPOP: metadata("LPOP", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LPOS: metadata("LPOS", "lists", ["CORE-LISTS"], ["Redis since 6.0.6", "Valkey since 6.0.6"]),
  LPUSH: metadata("LPUSH", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LPUSHX: metadata("LPUSHX", "lists", ["CORE-LISTS"], ["Redis since 2.2.0", "Valkey since 2.2.0"]),
  LRANGE: metadata("LRANGE", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LREM: metadata("LREM", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LSET: metadata("LSET", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  LTRIM: metadata("LTRIM", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  RPOP: metadata("RPOP", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  RPOPLPUSH: metadata(
    "RPOPLPUSH",
    "lists",
    ["CORE-LISTS"],
    ["Redis since 1.2.0", "Valkey since 1.2.0"],
  ),
  RPUSH: metadata("RPUSH", "lists", ["CORE-LISTS"], ["Redis since 1.0.0", "Valkey since 1.0.0"]),
  RPUSHX: metadata("RPUSHX", "lists", ["CORE-LISTS"], ["Redis since 2.2.0", "Valkey since 2.2.0"]),
};
