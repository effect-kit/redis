import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, tuple } from "#/command/reply/Data";
import { integer, optional, text } from "#/command/reply/Scalars";
import { score, scoreToken } from "#/command/reply/Score";
import { catalog } from "#/commands/geo/Catalog";
import { Latitude, Longitude, Unit } from "#/commands/geo/internal/Query";
import type { GeoUnit } from "#/commands/geo/internal/Query";
import { keyed } from "#/commands/internal/Command";
import { Argument, Arguments, parse } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import type { RedisArgument } from "#/RedisArgument";

export type { GeoUnit } from "#/commands/geo/internal/Query";

const Position = Schema.Struct({ longitude: Longitude, latitude: Latitude, member: Argument });
const Options = Schema.Struct({
  condition: Schema.optionalKey(Schema.Literals(["NX", "XX"])),
  changed: Schema.optionalKey(Schema.Boolean),
});
export type GeoPosition = typeof Position.Type;
export type GeoAddOptions = typeof Options.Type;

export const geoadd = (
  key: RedisArgument,
  positions: readonly [GeoPosition, ...GeoPosition[]],
  options: GeoAddOptions = {},
) =>
  keyed(
    catalog.GEOADD,
    key,
    Effect.gen(function* () {
      const entries = yield* parse(Schema.NonEmptyArray(Position), positions);
      const flags = yield* parse(Options, options);
      return [
        ...(flags.condition === undefined ? [] : [flags.condition]),
        ...(flags.changed ? ["CH"] : []),
        ...entries.flatMap((entry) => [
          String(entry.longitude),
          String(entry.latitude),
          entry.member,
        ]),
      ];
    }),
    integer,
    "read-write",
  );

export const geohash = (
  key: RedisArgument,
  members: readonly [RedisArgument, ...RedisArgument[]],
) => keyedVector(catalog.GEOHASH, key, parse(Arguments, members), array(optional(text)));

export const geopos = (key: RedisArgument, members: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyedVector(catalog.GEOPOS, key, parse(Arguments, members), array(nullable(tuple(score, score))));

export const geodist = (
  key: RedisArgument,
  first: RedisArgument,
  second: RedisArgument,
  unit: GeoUnit = "m",
) =>
  keyed(
    catalog.GEODIST,
    key,
    parse(Unit, unit).pipe(Effect.map((parsed) => [first, second, parsed])),
    optional(score),
  );

export const geodistToken = (
  key: RedisArgument,
  first: RedisArgument,
  second: RedisArgument,
  unit: GeoUnit = "m",
) =>
  keyed(
    catalog.GEODIST,
    key,
    parse(Unit, unit).pipe(Effect.map((parsed) => [first, second, parsed])),
    optional(scoreToken),
  );
