import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);
const two = (values: ReadonlyArray<unknown>) => assert.equal(values.length, 2);

export const geo = Effect.fnUntraced(function* ({ prefix, check }: Client) {
  const C = core.Commands;
  const key = `${prefix}:geo`;
  const point = { longitude: 13.361389, latitude: 38.115556, member: "Palermo" };
  const query = {
    origin: { member: "Palermo" },
    area: { radius: 200, unit: "km" as const },
    order: "ASC" as const,
  };

  yield* check(
    "geo.add",
    C.geoadd(key, [point, { longitude: 15.087269, latitude: 37.502669, member: "Catania" }]),
    2n,
  );
  yield* check("geo.hash", C.geohash(key, ["Palermo", "missing"]), [
    Option.some("sqc8b49rny0"),
    Option.none(),
  ]);
  yield* check("geo.positions", C.geopos(key, ["Palermo", "missing"]), (positions) => {
    assert.deepEqual(positions[1], Option.none());
    const position = positions[0];
    assert.ok(position !== undefined && Option.isSome(position));
    assert.ok(Math.abs(position.value[0] - point.longitude) < 0.0001);
    assert.ok(Math.abs(position.value[1] - point.latitude) < 0.0001);
  });
  yield* check("geo.distance", C.geodist(key, "Palermo", "Catania", "km"), (distance) => {
    assert.ok(Option.isSome(distance));
    assert.ok(Math.abs(distance.value - 166.2742) < 0.01);
  });
  yield* check("geo.distance-missing", C.geodistToken(key, "missing", "Catania"), Option.none());
  yield* check("geo.search", C.geosearch(key, query), [bytes("Palermo"), bytes("Catania")]);
  yield* check(
    "geo.details",
    C.geosearchWith(key, query, { coordinates: true, hash: true, distance: true }),
    (values) => {
      two(values);
      assert.deepEqual(values[0]?.member, bytes("Palermo"));
      assert.ok(
        values[0] !== undefined &&
          Option.isSome(values[0].coordinates) &&
          Option.isSome(values[0].hash) &&
          Option.isSome(values[0].distance),
      );
    },
  );
  yield* check("geo.search-store", C.geosearchstore(`${key}:search`, key, query, true), 2n);
  yield* check(
    "geo.radius",
    C.georadius(key, point.longitude, point.latitude, 200, "km", { order: "ASC" }),
    two,
  );
  yield* check(
    "geo.radius-ro",
    C.georadiusRo(key, point.longitude, point.latitude, 200, "km"),
    two,
  );
  yield* check("geo.member-radius", C.georadiusbymember(key, "Palermo", 200, "km"), two);
  yield* check("geo.member-radius-ro", C.georadiusbymemberRo(key, "Palermo", 200, "km"), two);
  yield* check(
    "geo.radius-details",
    C.georadiusWith(key, { member: "Palermo" }, 200, "km", { distance: true }, {}, true),
    two,
  );
  yield* check(
    "geo.radius-store",
    C.georadiusStore(key, `${key}:radius`, { member: "Palermo" }, 200, "km"),
    2n,
  );
});
