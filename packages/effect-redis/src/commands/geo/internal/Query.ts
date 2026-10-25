import { Effect, Schema } from "effect";

import { Argument, Finite, parse, Positive } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const Longitude = Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 }));
export const Latitude = Finite.check(
  Schema.isBetween({ minimum: -85.05112878, maximum: 85.05112878 }),
);
export const Unit = Schema.Literals(["m", "km", "ft", "mi"]);
export type GeoUnit = typeof Unit.Type;

export const Origin = Schema.Union([
  Schema.Struct({ member: Argument }),
  Schema.Struct({ longitude: Longitude, latitude: Latitude }),
]);
export const Radius = Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Area = Schema.Union([
  Schema.Struct({ radius: Radius, unit: Unit }),
  Schema.Struct({ width: Radius, height: Radius, unit: Unit }),
]);
export const Selection = Schema.Struct({
  order: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])),
  count: Schema.optionalKey(
    Schema.Struct({ value: Positive, any: Schema.optionalKey(Schema.Boolean) }),
  ),
});
export const Query = Schema.Struct({ origin: Origin, area: Area, ...Selection.fields });
export const Details = Schema.Struct({
  distance: Schema.optionalKey(Schema.Boolean),
  hash: Schema.optionalKey(Schema.Boolean),
  coordinates: Schema.optionalKey(Schema.Boolean),
});

export type GeoOrigin = typeof Origin.Type;
export type GeoQuery = typeof Query.Type;
export type GeoSelection = typeof Selection.Type;
export type GeoDetails = typeof Details.Type;

export const selectionTokens = (o: GeoSelection): RedisArgument[] => [
  ...(o.order === undefined ? [] : [o.order]),
  ...(o.count === undefined
    ? []
    : ["COUNT", String(o.count.value), ...(o.count.any ? ["ANY"] : [])]),
];

export const detailTokens = (o: GeoDetails): RedisArgument[] => [
  ...(o.distance ? ["WITHDIST"] : []),
  ...(o.hash ? ["WITHHASH"] : []),
  ...(o.coordinates ? ["WITHCOORD"] : []),
];

export const queryTokens = (query: GeoQuery) =>
  Effect.gen(function* () {
    const q = yield* parse(Query, query);
    const tokens: RedisArgument[] =
      "member" in q.origin
        ? ["FROMMEMBER", q.origin.member]
        : ["FROMLONLAT", String(q.origin.longitude), String(q.origin.latitude)];

    if ("radius" in q.area) tokens.push("BYRADIUS", String(q.area.radius), q.area.unit);
    else tokens.push("BYBOX", String(q.area.width), String(q.area.height), q.area.unit);

    tokens.push(...selectionTokens(q));
    return tokens;
  });
