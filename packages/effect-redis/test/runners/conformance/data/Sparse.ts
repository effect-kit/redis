import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { arrays } from "#test/runners/conformance/data/Arrays";
import { scans } from "#test/runners/conformance/data/Scans";

export const sparse = (fixture: Client) =>
  Effect.gen(function* () {
    yield* arrays(fixture);
    yield* scans(fixture);
  });
