import { primaryCases } from "#test/support/commands/Backend";

/** Fault scenarios use current pinned builds; ordinary Cluster conformance spans all primary baselines. */
export const currentClusterCases = primaryCases.filter(
  ({ target }) => target.fixture === target.product,
);
