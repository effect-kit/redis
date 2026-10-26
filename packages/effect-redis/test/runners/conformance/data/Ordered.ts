import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { bitmaps } from "#test/runners/conformance/data/Bitmaps";
import { geo } from "#test/runners/conformance/data/Geo";
import { sortedSets } from "#test/runners/conformance/data/SortedSets";

export const ordered = (fixture: Client) =>
  Effect.gen(function* () {
    yield* sortedSets(fixture);
    yield* bitmaps(fixture);
    yield* geo(fixture);
  });
