import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";

it.live.each(primaryCases)(
  "CORE-GEO: $target.fixture $protocol positions, detail order and stored searches",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix } = yield* backend(target, protocol);
      const key = `${prefix}:geo`;
      const point = { longitude: 13.361389, latitude: 38.115556, member: "Palermo" };
      const query = {
        origin: { member: "Palermo" },
        area: { radius: 200, unit: "km" as const },
        order: "ASC" as const,
      };

      expect(
        yield* redis.geoadd(key, [
          point,
          { longitude: 15.087269, latitude: 37.502669, member: "Catania" },
        ]),
      ).toBe(2n);
      expect(yield* redis.geohash(key, ["Palermo", "missing"])).toEqual([
        Option.some("sqc8b49rny0"),
        Option.none(),
      ]);
      const positions = yield* redis.geopos(key, ["Palermo", "missing"]);
      expect(positions[1]).toEqual(Option.none());
      const position = positions[0];
      if (position === undefined || Option.isNone(position))
        return yield* Effect.die("Missing stored position");
      expect(position.value[0]).toBeCloseTo(point.longitude, 4);
      expect(position.value[1]).toBeCloseTo(point.latitude, 4);
      const distance = yield* redis.geodist(key, "Palermo", "Catania", "km");
      if (Option.isNone(distance)) return yield* Effect.die("Missing distance");
      expect(distance.value).toBeCloseTo(166.2742, 2);
      expect(yield* redis.geodistToken(key, "missing", "Catania")).toEqual(Option.none());
      expect(yield* redis.geosearch(key, query)).toEqual([bytes("Palermo"), bytes("Catania")]);
      const details = yield* redis.geosearchWith(key, query, {
        coordinates: true,
        hash: true,
        distance: true,
      });
      expect(details).toHaveLength(2);
      expect(details[0]).toMatchObject({
        member: bytes("Palermo"),
        hash: { _tag: "Some" },
        coordinates: { _tag: "Some" },
        distance: { _tag: "Some" },
      });
      expect(yield* redis.geosearchstore(`${key}:search`, key, query, true)).toBe(2n);
      expect(
        yield* redis.georadius(key, point.longitude, point.latitude, 200, "km", { order: "ASC" }),
      ).toHaveLength(2);
      expect(
        yield* redis.georadiusRo(key, point.longitude, point.latitude, 200, "km"),
      ).toHaveLength(2);
      expect(yield* redis.georadiusbymember(key, "Palermo", 200, "km")).toHaveLength(2);
      expect(yield* redis.georadiusbymemberRo(key, "Palermo", 200, "km")).toHaveLength(2);
      expect(
        yield* redis.georadiusWith(
          key,
          { member: "Palermo" },
          200,
          "km",
          { distance: true },
          {},
          true,
        ),
      ).toHaveLength(2);
      expect(
        yield* redis.georadiusStore(key, `${key}:radius`, { member: "Palermo" }, 200, "km"),
      ).toBe(2n);

      expect(yield* Effect.flip(redis.geoadd(key, [{ ...point, latitude: 90 }]))).toMatchObject({
        _tag: "CommandInputError",
        delivery: "unsent",
      });
    }),
);
