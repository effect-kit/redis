import { Context } from "effect";

import { commandToken } from "#/connection/OrdinaryCommand";
import { ProfileError } from "#/errors/ProfileError";
import type { DeploymentProfile, Module } from "#/profiles/Profile";
import type { RedisCommand } from "#/protocol/encode";

export type CommandPolicy = (command: RedisCommand) => ProfileError | undefined;

/** Capture this policy in engines; a caller cannot change a retained client's deployment profile. */
export const ProfileCommandPolicy = Context.Reference<CommandPolicy>(
  "@envoy1084/effect-redis/ProfileCommandPolicy",
  { defaultValue: (): CommandPolicy => () => undefined },
);

const moduleOf = (name: string): Module | undefined => {
  if (name.startsWith("JSON.")) return "json";
  if (name.startsWith("FT.")) return "search";
  if (name.startsWith("TS.")) return "timeseries";
  if (["BF.", "CF.", "CMS.", "TOPK.", "TDIGEST."].some((prefix) => name.startsWith(prefix)))
    return "probabilistic";
  if (name.startsWith("SEARCH.")) return "upstash-search";
  if (name.startsWith("VECTOR.")) return "upstash-vector";
  if (
    [
      "VADD",
      "VCARD",
      "VDIM",
      "VEMB",
      "VGETATTR",
      "VINFO",
      "VISMEMBER",
      "VLINKS",
      "VRANDMEMBER",
      "VREM",
      "VSETATTR",
      "VSIM",
    ].includes(name)
  )
    return "vectors";
  return undefined;
};

export const commandPolicy = (profile?: DeploymentProfile): CommandPolicy => {
  if (profile === undefined) return () => undefined;
  const restricted = new Set(profile.restrictedCommands);
  const unavailable = new Set(profile.unsupportedModules);
  const enabled =
    profile.enabledModules === undefined ? undefined : new Set(profile.enabledModules);

  return (command) => {
    const name = commandToken(command[0]);
    if (restricted.has(name) || restricted.has(`${name} ${commandToken(command[1])}`))
      return new ProfileError({ delivery: "unsent", reason: "restricted-command" });
    const module = moduleOf(name);
    if (
      module !== undefined &&
      (unavailable.has(module) || (enabled !== undefined && !enabled.has(module)))
    )
      return new ProfileError({ delivery: "unsent", reason: "module" });
    return undefined;
  };
};
