import { Context } from "effect";

import type { DeploymentProfile } from "#/profiles/Profile";

/** Captured when a lease pool is built, never selected by a retained caller. */
export const PipelinedTransactions = Context.Reference<boolean>(
  "@effect-kit/redis/PipelinedTransactions",
  { defaultValue: () => false },
);

export const canPipelineTransactions = (profile: DeploymentProfile | undefined) =>
  profile !== undefined &&
  profile.routing === "standalone" &&
  (profile.id === "redis" || profile.id === "valkey") &&
  profile.restrictedCommands.length === 0;
