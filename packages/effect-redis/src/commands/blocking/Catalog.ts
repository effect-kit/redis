// Reviewed against the pinned Redis 8.10.2 and Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  BLPOP: metadata("BLPOP", "lists", ["BLOCK"], ["Redis since 2.0.0", "Valkey since 2.0.0"]),
  BRPOP: metadata("BRPOP", "lists", ["BLOCK"], ["Redis since 2.0.0", "Valkey since 2.0.0"]),
  BRPOPLPUSH: metadata(
    "BRPOPLPUSH",
    "lists",
    ["BLOCK"],
    ["Redis since 2.2.0", "Valkey since 2.2.0"],
  ),
  BLMOVE: metadata("BLMOVE", "lists", ["BLOCK"], ["Redis since 6.2.0", "Valkey since 6.2.0"]),
  BLMPOP: metadata("BLMPOP", "lists", ["BLOCK"], ["Redis since 7.0.0", "Valkey since 7.0.0"]),
  BLMOVEM: metadata(
    "BLMOVEM",
    "lists",
    ["BLOCK"],
    ["Redis since 8.10.0", "Absent from Valkey 9.1.2 source baseline"],
  ),
  BZPOPMIN: metadata(
    "BZPOPMIN",
    "sorted-sets",
    ["BLOCK"],
    ["Redis since 5.0.0", "Valkey since 5.0.0"],
  ),
  BZPOPMAX: metadata(
    "BZPOPMAX",
    "sorted-sets",
    ["BLOCK"],
    ["Redis since 5.0.0", "Valkey since 5.0.0"],
  ),
  BZMPOP: metadata("BZMPOP", "sorted-sets", ["BLOCK"], ["Redis since 7.0.0", "Valkey since 7.0.0"]),
};
