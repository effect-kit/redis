import { Effect, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { blob, integer } from "#/command/reply/Scalars";
import { catalog } from "#/commands/geo/Catalog";
import { Details, detailTokens, queryTokens } from "#/commands/geo/internal/Query";
import type { GeoDetails, GeoQuery } from "#/commands/geo/internal/Query";
import { geoResults } from "#/commands/geo/internal/Reply";
import { keyed, ordinary } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export type { GeoDetails, GeoQuery, GeoOrigin, GeoSelection } from "#/commands/geo/internal/Query";
export type { GeoResult } from "#/commands/geo/internal/Reply";

export const geosearch = (key: RedisArgument, query: GeoQuery) =>
  keyed(catalog.GEOSEARCH, key, queryTokens(query), array(blob));

export const geosearchWith = (key: RedisArgument, query: GeoQuery, details: GeoDetails) =>
  fromPreparation(
    Effect.gen(function* () {
      const parsed = { ...(yield* parse(Details, details)) };
      const tokens = [...(yield* queryTokens(query)), ...detailTokens(parsed)];

      // The decoder and wire flags must share the same preparation-time snapshot.
      return yield* keyed(catalog.GEOSEARCH, key, Effect.succeed(tokens), geoResults(parsed))
        .prepare;
    }),
  );

export const geosearchstore = (
  destination: RedisArgument,
  source: RedisArgument,
  query: GeoQuery,
  storeDistance = false,
) =>
  ordinary(
    catalog.GEOSEARCHSTORE,
    integer,
    Effect.gen(function* () {
      const args = yield* queryTokens(query);
      const distance = yield* parse(Schema.Boolean, storeDistance);
      return {
        tokens: [
          "GEOSEARCHSTORE",
          destination,
          source,
          ...args,
          ...(distance ? ["STOREDIST"] : []),
        ],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 1, access: "write" },
            { index: 2, access: "read" },
          ],
        },
      };
    }),
  );
