import { Effect, Predicate, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blob, integer } from "#/command/reply/Scalars";
import { catalog } from "#/commands/geo/Catalog";
import {
  Origin,
  Radius,
  Selection,
  Unit,
  selectionTokens,
  Details,
  detailTokens,
} from "#/commands/geo/internal/Query";
import type { GeoDetails, GeoOrigin, GeoSelection, GeoUnit } from "#/commands/geo/internal/Query";
import { geoResults } from "#/commands/geo/internal/Reply";
import { keyed, ordinary } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

const radiusArgs = (origin: GeoOrigin, radius: number, unit: GeoUnit, options: GeoSelection) =>
  Effect.gen(function* () {
    const center = yield* parse(Origin, origin);
    const size = yield* parse(Radius, radius);
    const distance = yield* parse(Unit, unit);
    const select = yield* parse(Selection, options);
    return [
      ...("member" in center
        ? [center.member]
        : [String(center.longitude), String(center.latitude)]),
      String(size),
      distance,
      ...selectionTokens(select),
    ];
  });

export const georadius = (
  key: RedisArgument,
  longitude: number,
  latitude: number,
  radius: number,
  unit: GeoUnit,
  options: GeoSelection = {},
) =>
  keyed(
    catalog.GEORADIUS,
    key,
    radiusArgs({ longitude, latitude }, radius, unit, options),
    array(blob),
  );

export const georadiusRo = (
  key: RedisArgument,
  longitude: number,
  latitude: number,
  radius: number,
  unit: GeoUnit,
  options: GeoSelection = {},
) =>
  keyed(
    catalog.GEORADIUS_RO,
    key,
    radiusArgs({ longitude, latitude }, radius, unit, options),
    array(blob),
  );

export const georadiusbymember = (
  key: RedisArgument,
  member: RedisArgument,
  radius: number,
  unit: GeoUnit,
  options: GeoSelection = {},
) =>
  keyed(catalog.GEORADIUSBYMEMBER, key, radiusArgs({ member }, radius, unit, options), array(blob));

export const georadiusbymemberRo = (
  key: RedisArgument,
  member: RedisArgument,
  radius: number,
  unit: GeoUnit,
  options: GeoSelection = {},
) =>
  keyed(
    catalog.GEORADIUSBYMEMBER_RO,
    key,
    radiusArgs({ member }, radius, unit, options),
    array(blob),
  );

/** One detail API covers both coordinate and member forms without conflating STORE replies. */
export const georadiusWith = (
  key: RedisArgument,
  origin: GeoOrigin,
  radius: number,
  unit: GeoUnit,
  details: GeoDetails,
  options: GeoSelection = {},
  readOnly = false,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const parsed = { ...(yield* parse(Details, details)) };
      const ro = yield* parse(Schema.Boolean, readOnly);
      const member = Predicate.hasProperty(origin, "member");
      const info = member
        ? ro
          ? catalog.GEORADIUSBYMEMBER_RO
          : catalog.GEORADIUSBYMEMBER
        : ro
          ? catalog.GEORADIUS_RO
          : catalog.GEORADIUS;
      const args = [...(yield* radiusArgs(origin, radius, unit, options)), ...detailTokens(parsed)];

      return yield* keyed(info, key, Effect.succeed(args), geoResults(parsed)).prepare;
    }),
  );

export const georadiusStore = (
  key: RedisArgument,
  destination: RedisArgument,
  origin: GeoOrigin,
  radius: number,
  unit: GeoUnit,
  options: GeoSelection = {},
  storeDistance = false,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const center = yield* parse(Origin, origin);
      const args = yield* radiusArgs(center, radius, unit, options);
      const distance = yield* parse(Schema.Boolean, storeDistance);
      const name = "member" in center ? "GEORADIUSBYMEMBER" : "GEORADIUS";
      const tokens: [RedisArgument, ...RedisArgument[]] = [
        name,
        key,
        ...args,
        distance ? "STOREDIST" : "STORE",
        destination,
      ];

      return yield* ordinary(
        catalog[name],
        integer,
        Effect.succeed({
          tokens,
          routing: {
            _tag: "Keys",
            keys: [
              { index: 1, access: "read" },
              { index: tokens.length - 1, access: "write" },
            ],
          },
        }),
      ).prepare;
    }),
  );
