// Reviewed availability from the Redis 8.10.2 / Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  BITCOUNT: metadata(
    "BITCOUNT",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 2.6.0", "Valkey since 2.6.0"],
  ),
  BITFIELD: metadata(
    "BITFIELD",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 3.2.0", "Valkey since 3.2.0"],
  ),
  BITFIELD_RO: metadata(
    "BITFIELD_RO",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 6.0.0", "Valkey since 6.0.0"],
  ),
  BITOP: metadata(
    "BITOP",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 2.6.0", "Valkey since 2.6.0"],
  ),
  BITPOS: metadata(
    "BITPOS",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 2.8.7", "Valkey since 2.8.7"],
  ),
  GETBIT: metadata(
    "GETBIT",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 2.2.0", "Valkey since 2.2.0"],
  ),
  SETBIT: metadata(
    "SETBIT",
    "bitmaps",
    ["CORE-BITMAPS"],
    ["Redis since 2.2.0", "Valkey since 2.2.0"],
  ),
};
