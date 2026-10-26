import { Effect, Schedule } from "effect";

import type { RedisClient } from "#/Redis";
import type { RedisArgument } from "#/RedisArgument";
import { FixtureError } from "#test/support/servers/FixtureError";

/** Index workers can lag behind a completed HASH write; wait for this fixture's expected receipt. */
export const waitForSearchCount = (
  redis: RedisClient,
  index: RedisArgument,
  count: bigint,
  query: RedisArgument,
) =>
  redis.ftSearch(index, query, { noContent: true, dialect: 2 }).pipe(
    Effect.flatMap((reply) =>
      reply.total === count
        ? Effect.void
        : Effect.fail(new FixtureError({ stage: "search-index-not-ready" })),
    ),
    Effect.retry({
      times: 100,
      schedule: Schedule.spaced(10),
      while: (error) => error instanceof FixtureError,
    }),
  );
