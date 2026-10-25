import { Effect, Option } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, pairs, simpleText, tuple, unsigned } from "#/command/reply/Data";
import { mismatch } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { name, names, sentinelCommand } from "#/commands/sentinel/Build";

export interface SentinelAddress {
  readonly host: string;
  readonly port: number;
}

export const addressReply = (reply: Parameters<typeof simpleText>[0]) =>
  nullable(tuple(simpleText, unsigned))(reply).pipe(
    Effect.flatMap((value) => {
      if (Option.isNone(value)) return Effect.succeed(Option.none<SentinelAddress>());
      const [host, port] = value.value;
      return host.length === 0 || port < 1n || port > 65535n
        ? Effect.fail(mismatch("custom", reply))
        : Effect.succeed(Option.some({ host, port: Number(port) }));
    }),
  );

export const sentinelGetMasterAddrByName = (service: string) =>
  sentinelCommand("GET-MASTER-ADDR-BY-NAME", addressReply, name(service));
export const sentinelGetPrimaryAddrByName = (service: string) =>
  sentinelCommand("GET-PRIMARY-ADDR-BY-NAME", addressReply, name(service));
export const sentinelMaster = (service: string) => sentinelCommand("MASTER", fields, name(service));
export const sentinelPrimary = (service: string) =>
  sentinelCommand("PRIMARY", fields, name(service));
export const sentinelMasters = () => sentinelCommand("MASTERS", array(fields));
export const sentinelPrimaries = () => sentinelCommand("PRIMARIES", array(fields));
export const sentinelReplicas = (service: string) =>
  sentinelCommand("REPLICAS", array(fields), name(service));
export const sentinelSlaves = (service: string) =>
  sentinelCommand("SLAVES", array(fields), name(service));
export const sentinelSentinels = (service: string) =>
  sentinelCommand("SENTINELS", array(fields), name(service));

/** Cached INFO remains ordered and may be absent; ages retain exact integer milliseconds. */
export const sentinelInfoCache = (services: readonly [string, ...string[]]) =>
  sentinelCommand(
    "INFO-CACHE",
    pairs(simpleText, pairs(unsigned, nullable(simpleText))),
    names(services),
  );
