import { Effect, Schema } from "effect";

import { CredentialLifetime } from "#/credentials/Lifetime";
import { ProfileError } from "#/errors/ProfileError";

export const Routing = Schema.Literals(["standalone", "proxy", "cluster", "sentinel", "http"]);
export type Routing = typeof Routing.Type;
export const Module = Schema.Literals([
  "json",
  "search",
  "timeseries",
  "probabilistic",
  "vectors",
  "upstash-search",
  "upstash-vector",
]);
export type Module = typeof Module.Type;

export const DeploymentProfile = Schema.Struct({
  id: Schema.NonEmptyString.check(Schema.isMaxLength(128), Schema.isPattern(/^[a-z0-9.-]+$/)),
  routing: Routing,
  tls: Schema.Literals(["optional", "required"]),
  authentication: Schema.Literals(["optional", "password", "iam", "entra", "bearer", "mtls"]),
  database: Schema.Literals(["any", "zero"]),
  restrictedCommands: Schema.Array(
    Schema.NonEmptyString.check(Schema.isPattern(/^[A-Z0-9_.-]+(?: [A-Z0-9_.-]+)?$/)),
  ),
  unsupportedModules: Schema.Array(Module),
  enabledModules: Schema.optionalKey(Schema.Array(Module)),
  credentialLifetime: Schema.optionalKey(CredentialLifetime),
  sources: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isPattern(/^https:\/\//))),
  revision: Schema.Literal("reviewed-2026-10-26"),
  certification: Schema.Literal("pending"),
});
export type DeploymentProfile = typeof DeploymentProfile.Encoded;
export type ValidatedProfile = typeof DeploymentProfile.Type;

export const decodeProfile = (input: unknown) =>
  Schema.decodeUnknownEffect(DeploymentProfile, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(() => new ProfileError({ delivery: "unsent", reason: "configuration" })),
  );

export interface ProfileOptions {
  /** Actual configured modules; omission leaves unreviewed availability to the server. */
  readonly modules?: ReadonlyArray<Module>;
}

export const profile = (
  input: Omit<DeploymentProfile, "revision" | "certification" | "unsupportedModules"> & {
    readonly unsupportedModules?: ReadonlyArray<Module>;
  },
): DeploymentProfile => ({
  ...input,
  unsupportedModules: input.unsupportedModules ?? [],
  revision: "reviewed-2026-10-26",
  certification: "pending",
});

export const selectedModules = (options: ProfileOptions) =>
  options.modules === undefined ? {} : { enabledModules: options.modules };
