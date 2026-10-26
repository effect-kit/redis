import { profile, selectedModules } from "#/profiles/Profile";
import type { ProfileOptions } from "#/profiles/Profile";

export interface NativeEngineOptions extends ProfileOptions {
  readonly routing?: "standalone" | "cluster" | "sentinel";
}

const native = (id: string, source: string, options: NativeEngineOptions) =>
  profile({
    id,
    routing: options.routing ?? "standalone",
    tls: "optional",
    authentication: "optional",
    database: "any",
    restrictedCommands: [],
    sources: [source],
    ...selectedModules(options),
  });

export const redis = (options: NativeEngineOptions = {}) =>
  native("redis", "https://redis.io/docs/latest/develop/reference/", options);
export const valkey = (options: NativeEngineOptions = {}) =>
  native("valkey", "https://valkey.io/topics/", options);
export const dragonfly = (options: ProfileOptions = {}) =>
  native("dragonfly", "https://www.dragonflydb.io/docs/", options);
export const keydb = (options: ProfileOptions = {}) =>
  native("keydb", "https://docs.keydb.dev/", options);
export const redict = (options: ProfileOptions = {}) =>
  native("redict", "https://redict.io/docs/", options);
export const garnet = (options: ProfileOptions = {}) =>
  native("garnet", "https://microsoft.github.io/garnet/docs/welcome/compatibility", options);
export const kvrocks = (options: ProfileOptions = {}) =>
  native("kvrocks", "https://kvrocks.apache.org/docs/", options);
