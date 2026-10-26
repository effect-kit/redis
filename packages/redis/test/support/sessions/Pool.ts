import { Effect } from "effect";

import { decodeRedisConfig } from "#/RedisConfig";
import { makeLeasePool } from "#/sessions/pool/LeasePool";
import type { LeasePool } from "#/sessions/pool/LeasePool";
import { decodeSessionPolicy } from "#/sessions/pool/Options";
import type { SessionOptions } from "#/sessions/pool/Options";
import { reconnecting } from "#test/support/connection/Controlled";

export const poolFixture = Effect.fnUntraced(function* (
  options: SessionOptions = {},
  input: Record<string, unknown> = {},
) {
  const fixture = yield* reconnecting();
  const config = yield* decodeRedisConfig({
    endpoint: { host: "localhost" },
    protocol: "resp2",
    ...input,
  });
  const { connection, ...policyInput } = options;
  const policy = yield* decodeSessionPolicy(policyInput);
  const pool = yield* makeLeasePool(config, policy, connection ?? {}).pipe(
    Effect.provide(fixture.layer),
  );

  const [primary, secondary] = fixture.fixtures;
  if (primary === undefined || secondary === undefined)
    return yield* Effect.die(new Error("Missing controlled pool fixtures"));

  return { ...fixture, primary, secondary, pool, config, policy };
});

export const waitForPool = Effect.fnUntraced(function* (
  pool: LeasePool,
  predicate: (snapshot: Effect.Success<LeasePool["snapshot"]>) => boolean,
) {
  while (true) {
    const snapshot = yield* pool.snapshot;
    if (predicate(snapshot)) return snapshot;
    yield* Effect.yieldNow;
  }
});
