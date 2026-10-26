import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { batches } from "#test/runners/conformance/sessions/Batches";
import { blocking } from "#test/runners/conformance/sessions/Blocking";
import { scripting } from "#test/runners/conformance/sessions/Scripting";

export const sessions = (fixture: Client) =>
  Effect.gen(function* () {
    yield* batches(fixture);
    yield* blocking(fixture);
    yield* scripting(fixture);
  });
