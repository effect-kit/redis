import { Effect, Schema } from "effect";

import { trackingTokens } from "#/commands/tracking/Controls";
import type { TrackingOptions } from "#/commands/tracking/Controls";
import { decode, PositiveInteger } from "#/config/Validation";
import type { ConnectionOptions } from "#/connection/Options";
import type { RedisArgument } from "#/RedisArgument";

const defaulted = (value: number) =>
  PositiveInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const Runtime = Schema.Struct({
  delivery: Schema.Literals(["auto", "redirect"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("auto")),
  ),
  maxWaiters: defaulted(128),
  maxMessages: defaulted(64),
  maxBytes: defaulted(1024 * 1024),
  heartbeatMillis: defaulted(30_000),
});

export interface TrackingRuntimeOptions<R = never> {
  readonly tracking?:
    | Omit<Exclude<TrackingOptions, { mode: "broadcast" }>, "redirect">
    | {
        readonly mode: "broadcast";
        readonly prefixes?: ReadonlyArray<RedisArgument>;
        readonly noLoop?: boolean;
      };
  readonly delivery?: "auto" | "redirect";
  readonly maxWaiters?: number;
  readonly maxMessages?: number;
  readonly maxBytes?: number;
  readonly heartbeatMillis?: number;
  readonly credentials?: ConnectionOptions<R>["credentials"];
}

export const decodeTrackingRuntime = Effect.fnUntraced(function* <R>(
  options: TrackingRuntimeOptions<R>,
) {
  const { tracking = {}, credentials, ...input } = options;
  const runtime = yield* decode(Runtime, "tracking", input);
  // Runtime owns its redirection target; arbitrary IDs belong to the exclusive control API.
  yield* trackingTokens(true, tracking);
  if ("redirect" in tracking) return yield* decode(Schema.Never, "tracking", tracking);
  const selected: TrackingOptions =
    tracking.mode === "broadcast"
      ? {
          ...tracking,
          ...(tracking.prefixes === undefined
            ? {}
            : {
                prefixes: tracking.prefixes.map((prefix) =>
                  typeof prefix === "string" ? new TextEncoder().encode(prefix) : prefix.slice(),
                ),
              }),
        }
      : { ...tracking };

  return { runtime, selected, credentials };
});
