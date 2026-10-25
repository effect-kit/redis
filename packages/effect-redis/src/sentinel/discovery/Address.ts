import { Effect, Redacted, Schema } from "effect";

import { simpleText } from "#/command/reply/Data";
import type { SentinelAddress } from "#/commands/sentinel/Discovery";
import { decode } from "#/config/Validation";
import { SentinelError } from "#/errors/SentinelError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import type { SentinelOptions, SentinelPolicy } from "#/sentinel/Options";

const Address = Schema.Struct({
  host: Schema.NonEmptyString.check(
    Schema.isPattern(/^[^\s/@?#]+$/),
    Schema.makeFilter((host) => !host.includes("\0")),
  ),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  serverName: Schema.optionalKey(Schema.NonEmptyString),
});

export const addressIdentity = (address: SentinelAddress) =>
  JSON.stringify([address.host, address.port]);

export const connectionConfig = Effect.fnUntraced(function* <R>(
  base: RedisConfig,
  address: SentinelAddress,
  plane: "sentinel" | "data",
  policy: SentinelPolicy,
  options: SentinelOptions<R>,
) {
  const announced = { host: address.host, port: address.port };
  const mapped = yield* decode(
    Address,
    `sentinel.${plane}.address`,
    options.addressMap?.(announced, plane) ?? announced,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SentinelError({
          reason: "invalid-reply",
          plane,
          delivery: "unsent",
          cause: Redacted.make(cause),
        }),
    ),
  );
  const tls =
    plane === "data"
      ? policy.dataTls
      : base.endpoint._tag === "Tcp"
        ? base.endpoint.tls
        : undefined;

  return {
    ...base,
    endpoint: {
      _tag: "Tcp",
      host: mapped.host,
      port: mapped.port,
      ...(tls === undefined
        ? {}
        : {
            tls: {
              ...tls,
              serverName: mapped.serverName ?? tls.serverName ?? address.host,
            },
          }),
    },
  } satisfies RedisConfig;
});

/** Required discovery fields must be unique; unknown report fields remain available to callers. */
export const reportedAddress = Effect.fnUntraced(function* (
  fields: ReadonlyArray<readonly [string, RespValue]>,
) {
  const selected = new Map<string, string>();
  for (const [key, value] of fields) {
    const name = key;
    if (!["ip", "port", "flags", "master-link-status"].includes(name)) continue;
    if (selected.has(name))
      return yield* new SentinelError({
        plane: "sentinel",
        reason: "invalid-reply",
        delivery: "replied",
      });
    selected.set(name, yield* simpleText(value));
  }
  const host = selected.get("ip");
  const port = selected.get("port");
  if (host === undefined || port === undefined || !/^[0-9]{1,5}$/.test(port))
    return yield* new SentinelError({
      plane: "sentinel",
      reason: "invalid-reply",
      delivery: "replied",
    });
  const address = yield* decode(Address, "sentinel.address", { host, port: Number(port) });
  const flags = (selected.get("flags") ?? "").split(",");

  return {
    address,
    available:
      !flags.some((flag) => ["s_down", "o_down", "disconnected"].includes(flag)) &&
      selected.get("master-link-status") !== "err",
  };
});
