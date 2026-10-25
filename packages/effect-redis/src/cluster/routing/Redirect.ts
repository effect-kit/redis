import { Effect, Schema } from "effect";

import { decodeAddress } from "#/cluster/topology/Decode";
import type { ClusterAddress } from "#/cluster/topology/Types";
import { undecorate } from "#/command/reply/Scalars";
import { ClusterError } from "#/errors/ClusterError";
import type { RespValue } from "#/protocol/RespValue";

const WireRedirect = Schema.String.check(
  Schema.isPattern(/^(MOVED|ASK) (?:0|[1-9]\d{0,4}) [^\s]+$/),
);

const invalid = () => new ClusterError({ reason: "invalid-redirect", delivery: "replied" });

export const redirect = Effect.fnUntraced(function* (reply: RespValue, peer: ClusterAddress) {
  const value = undecorate(reply);
  if (value._tag !== "SimpleError" && value._tag !== "BlobError") return undefined;
  // Inspect only bounded routing errors; arbitrary server/application payloads stay redacted.
  const prefix = new TextDecoder().decode(value.value.subarray(0, 6));
  if (!prefix.startsWith("MOVED ") && !prefix.startsWith("ASK ")) return undefined;
  if (value.value.length > 1024) return yield* invalid();

  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(value.value),
    catch: invalid,
  });
  yield* Schema.decodeUnknownEffect(WireRedirect)(text).pipe(Effect.mapError(invalid));
  const [kind, rawSlot = "", endpoint = ""] = text.split(" ");
  const slot = Number(rawSlot);
  const colon = endpoint.lastIndexOf(":");
  if (slot >= 16384 || colon < 0 || !/^[1-9]\d{0,4}$/.test(endpoint.slice(colon + 1)))
    return yield* invalid();
  const host = endpoint.slice(0, colon).replace(/^\[|\]$/g, "");
  const address = yield* decodeAddress({
    host: host || peer.host,
    port: Number(endpoint.slice(colon + 1)),
  }).pipe(Effect.mapError(invalid));

  return { kind: kind as "MOVED" | "ASK", slot, address };
});
