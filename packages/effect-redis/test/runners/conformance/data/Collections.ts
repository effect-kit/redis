import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { hashes } from "#test/runners/conformance/data/Hashes";
import { lists } from "#test/runners/conformance/data/Lists";
import { sets } from "#test/runners/conformance/data/Sets";

export const collections = (fixture: Client) =>
  Effect.gen(function* () {
    yield* hashes(fixture);
    yield* lists(fixture);
    yield* sets(fixture);
  });
