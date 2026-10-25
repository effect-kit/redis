import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import type { RespValue } from "#/protocol/RespValue";

export type SubscriptionMode = "channel" | "pattern" | "shard";

export type EventFrame =
  | {
      readonly _tag: "Acknowledgment";
      readonly kind: string;
      readonly target: Uint8Array;
      readonly count: bigint;
    }
  | { readonly _tag: "Message"; readonly channel: Uint8Array; readonly payload: Uint8Array }
  | {
      readonly _tag: "PatternMessage";
      readonly pattern: Uint8Array;
      readonly channel: Uint8Array;
      readonly payload: Uint8Array;
    }
  | { readonly _tag: "ShardMessage"; readonly channel: Uint8Array; readonly payload: Uint8Array }
  | { readonly _tag: "Invalidate"; readonly keys: ReadonlyArray<Uint8Array> | null }
  | { readonly _tag: "TrackingLost" }
  | { readonly _tag: "Pong" }
  | { readonly _tag: "UnknownPush"; readonly value: RespValue };

export const acknowledgmentKinds = new Set([
  "subscribe",
  "unsubscribe",
  "psubscribe",
  "punsubscribe",
  "ssubscribe",
  "sunsubscribe",
]);

const invalidateChannel = new TextEncoder().encode("__redis__:invalidate");

export const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

/** RESP2 arrays are classified only by reviewed event kinds; arbitrary arrays remain replies. */
export const eventFrame = Effect.fnUntraced(function* (reply: RespValue) {
  const value = undecorate(reply);
  if (value._tag !== "Array" && value._tag !== "Push") return undefined;

  const first = value.values[0];
  const kind =
    first?._tag === "BlobString" || first?._tag === "SimpleString"
      ? new TextDecoder().decode(first.value)
      : undefined;
  const at = (index: number) => value.values[index];
  const binary = (index: number) => {
    const entry = at(index);
    return entry === undefined ? Effect.fail(mismatch("array-length", reply)) : blob(entry);
  };
  const size = (count: number) =>
    value.values.length === count ? Effect.void : Effect.fail(mismatch("array-length", reply));

  if (kind !== undefined && acknowledgmentKinds.has(kind)) {
    yield* size(3);
    const count = at(2);
    if (count === undefined) return yield* mismatch("array-length", reply);
    return {
      _tag: "Acknowledgment",
      kind,
      target: yield* binary(1),
      count: yield* unsigned(count),
    } satisfies EventFrame;
  }

  if (kind === "pmessage") {
    yield* size(4);
    return {
      _tag: "PatternMessage",
      pattern: yield* binary(1),
      channel: yield* binary(2),
      payload: yield* binary(3),
    } satisfies EventFrame;
  }

  if (kind === "message" || kind === "smessage") {
    yield* size(3);
    const channel = yield* binary(1);
    const payload = at(2);
    // RESP2 redirected invalidations deliberately carry an aggregate payload.
    if (
      kind === "message" &&
      sameBytes(channel, invalidateChannel) &&
      payload !== undefined &&
      (undecorate(payload)._tag === "Array" || undecorate(payload)._tag === "Null")
    )
      return {
        _tag: "Invalidate",
        keys: undecorate(payload)._tag === "Null" ? null : yield* array(blob)(payload),
      } satisfies EventFrame;

    return {
      _tag: kind === "message" ? "Message" : "ShardMessage",
      channel,
      payload: yield* binary(2),
    } satisfies EventFrame;
  }

  if (kind === "invalidate") {
    yield* size(2);
    const keys = at(1);
    if (keys === undefined) return yield* mismatch("array-length", reply);
    return {
      _tag: "Invalidate",
      keys: undecorate(keys)._tag === "Null" ? null : yield* array(blob)(keys),
    } satisfies EventFrame;
  }

  if (kind === "tracking-redir-broken") return { _tag: "TrackingLost" } satisfies EventFrame;
  if (kind === "pong") {
    yield* size(2);
    yield* binary(1);
    return { _tag: "Pong" } satisfies EventFrame;
  }

  return value._tag === "Push"
    ? ({ _tag: "UnknownPush", value: reply } satisfies EventFrame)
    : undefined;
});

export const subscribeKind = (mode: SubscriptionMode) =>
  ({ channel: "subscribe", pattern: "psubscribe", shard: "ssubscribe" })[mode];

export const unsubscribeKind = (mode: SubscriptionMode) =>
  ({ channel: "unsubscribe", pattern: "punsubscribe", shard: "sunsubscribe" })[mode];

/** Length-prefix byte identities avoid UTF-8 replacement and delimiter collisions. */
export const byteIdentity = (bytes: Uint8Array) => {
  let identity = `${bytes.length}:`;
  for (const byte of bytes) identity += String.fromCharCode(byte);
  return identity;
};
