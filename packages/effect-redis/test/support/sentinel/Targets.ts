import { primaryCases } from "#test/support/commands/Backend";

/** Advanced failover scenarios use current pinned builds; discovery spans every primary baseline. */
export const currentSentinelCases = primaryCases.filter(
  ({ target }) => target.fixture === target.product,
);
