import { Effect } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { pubsub } from "#test/runners/conformance/events/PubSub";
import { streams } from "#test/runners/conformance/events/Streams";

export const events = (fixture: Client) =>
  Effect.gen(function* () {
    yield* streams(fixture);
    yield* pubsub(fixture);
  });
