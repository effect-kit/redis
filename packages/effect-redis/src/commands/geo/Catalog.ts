// Reviewed availability from the Redis 8.10.2 / Valkey 9.1.2 source inventories.
import { metadata } from "#/commands/Metadata";

export const catalog = {
  GEOADD: metadata("GEOADD", "geo", ["CORE-GEO"], ["Redis since 3.2.0", "Valkey since 3.2.0"]),
  GEODIST: metadata("GEODIST", "geo", ["CORE-GEO"], ["Redis since 3.2.0", "Valkey since 3.2.0"]),
  GEOHASH: metadata("GEOHASH", "geo", ["CORE-GEO"], ["Redis since 3.2.0", "Valkey since 3.2.0"]),
  GEOPOS: metadata("GEOPOS", "geo", ["CORE-GEO"], ["Redis since 3.2.0", "Valkey since 3.2.0"]),
  GEORADIUS: metadata(
    "GEORADIUS",
    "geo",
    ["CORE-GEO"],
    ["Redis since 3.2.0", "Valkey since 3.2.0"],
  ),
  GEORADIUSBYMEMBER: metadata(
    "GEORADIUSBYMEMBER",
    "geo",
    ["CORE-GEO"],
    ["Redis since 3.2.0", "Valkey since 3.2.0"],
  ),
  GEORADIUSBYMEMBER_RO: metadata(
    "GEORADIUSBYMEMBER_RO",
    "geo",
    ["CORE-GEO"],
    ["Redis since 3.2.10", "Valkey since 3.2.10"],
  ),
  GEORADIUS_RO: metadata(
    "GEORADIUS_RO",
    "geo",
    ["CORE-GEO"],
    ["Redis since 3.2.10", "Valkey since 3.2.10"],
  ),
  GEOSEARCH: metadata(
    "GEOSEARCH",
    "geo",
    ["CORE-GEO"],
    ["Redis since 6.2.0", "Valkey since 6.2.0"],
  ),
  GEOSEARCHSTORE: metadata(
    "GEOSEARCHSTORE",
    "geo",
    ["CORE-GEO"],
    ["Redis since 6.2.0", "Valkey since 6.2.0"],
  ),
};
