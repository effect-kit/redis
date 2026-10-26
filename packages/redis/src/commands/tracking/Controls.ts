import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { members, pairs } from "#/command/reply/Data";
import { blob, integer, mismatch, status, text } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { ReplyError } from "#/errors/ReplyError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

export type TrackingOptions =
  | {
      readonly mode?: "default" | "optin" | "optout";
      readonly prefixes?: never;
      readonly redirect?: Integer;
      readonly noLoop?: boolean;
    }
  | {
      readonly mode: "broadcast";
      readonly prefixes?: ReadonlyArray<RedisArgument>;
      readonly redirect?: Integer;
      readonly noLoop?: boolean;
    };

const Options = Schema.Struct({
  mode: Schema.optionalKey(Schema.Literals(["default", "optin", "optout", "broadcast"])),
  prefixes: Schema.optionalKey(Schema.Array(Argument)),
  redirect: Schema.optionalKey(NonNegative),
  noLoop: Schema.optionalKey(Schema.Boolean),
});

export const trackingTokens = Effect.fnUntraced(function* (
  enabled: boolean,
  options: TrackingOptions = {},
) {
  yield* parse(Schema.Boolean, enabled);
  const selected = yield* parse(Options, options);
  if (
    (!enabled && Object.keys(selected).length > 0) ||
    (selected.prefixes !== undefined && selected.mode !== "broadcast")
  )
    return yield* parse(Schema.Never, options);

  return [
    "CLIENT",
    "TRACKING",
    enabled ? "ON" : "OFF",
    ...(selected.redirect === undefined ? [] : ["REDIRECT", String(selected.redirect)]),
    ...(selected.mode === undefined || selected.mode === "default"
      ? []
      : [{ optin: "OPTIN", optout: "OPTOUT", broadcast: "BCAST" }[selected.mode]]),
    ...(selected.prefixes ?? []).flatMap((prefix) => ["PREFIX", prefix]),
    ...(selected.noLoop ? ["NOLOOP"] : []),
  ] as const;
});

export const clientTracking = (enabled: boolean, options?: TrackingOptions) =>
  ordinary(
    {
      ...metadata("CLIENT TRACKING", "tracking", ["TRACK"], ["Since 6.0.0"]),
      execution: "exclusive",
    },
    status("OK"),
    trackingTokens(enabled, options).pipe(
      Effect.map((tokens) => ({ tokens, routing: { _tag: "Keyless" } as const })),
    ),
  );

export interface TrackingInfo {
  readonly flags: ReadonlyArray<string>;
  readonly redirect: bigint;
  readonly prefixes: ReadonlyArray<Uint8Array>;
  readonly attributes: ReadonlyArray<readonly [string, RespValue]>;
}

export const trackingInfo = Effect.fnUntraced(function* (
  reply: RespValue,
): Effect.fn.Return<TrackingInfo, ReplyError> {
  const attributes = yield* pairs(text, (value) => Effect.succeed(value))(reply);
  const flags = attributes.find(([name]) => name === "flags")?.[1];
  const redirect = attributes.find(([name]) => name === "redirect")?.[1];
  const prefixes = attributes.find(([name]) => name === "prefixes")?.[1];
  if (flags === undefined || redirect === undefined || prefixes === undefined)
    return yield* mismatch("custom", reply);

  return {
    flags: yield* members(text)(flags),
    redirect: yield* integer(redirect),
    prefixes: yield* array(blob)(prefixes),
    attributes,
  };
});

export const clientTrackingInfo = () =>
  ordinary(
    {
      ...metadata("CLIENT TRACKINGINFO", "tracking", ["TRACK"], ["Since 6.2.0"]),
      execution: "exclusive",
    },
    trackingInfo,
    Effect.succeed({
      tokens: ["CLIENT", "TRACKINGINFO"] as const,
      routing: { _tag: "Keyless" } as const,
    }),
  );
