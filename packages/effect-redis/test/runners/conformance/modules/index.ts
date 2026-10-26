import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { json } from "#test/runners/conformance/modules/Json";
import { search } from "#test/runners/conformance/modules/Search";
import { structures } from "#test/runners/conformance/modules/Structures";

export const modules = (fixture: Client) =>
  Effect.gen(function* () {
    yield* json(fixture);
    yield* search(fixture);
    yield* structures(fixture);
  });
