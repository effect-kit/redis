import { Effect, Schema } from "effect";

import { keySlot } from "#/cluster/Slot";
import { array } from "#/command/reply/Collections";
import { simpleText } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { Slot } from "#/commands/cluster/Build";
import { ordinary } from "#/commands/internal/Command";
import { Argument, Positive, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { KeyScanOptions } from "#/commands/scan/Build";
import type { ScanPage } from "#/commands/scan/Page";
import type { ReplyError } from "#/errors/ReplyError";

const Options = Schema.Struct({
  match: Schema.optionalKey(Argument),
  count: Schema.optionalKey(Positive),
  type: Schema.optionalKey(Argument),
  slot: Schema.optionalKey(Slot),
});
export interface ClusterScanOptions extends KeyScanOptions {
  readonly slot?: number;
}

/** Valkey's cursor is opaque and contains a routing hash tag, not a uint64 SCAN cursor. */
export const clusterScan = (cursor = "0", options: ClusterScanOptions = {}) =>
  ordinary(
    metadata("CLUSTERSCAN", "cluster", ["CLUSTER"], ["Valkey since9.1.0"]),
    (reply) =>
      Effect.gen(function* (): Effect.fn.Return<ScanPage<Uint8Array>, ReplyError> {
        const value = undecorate(reply);
        if (value._tag !== "Array" || value.values.length !== 2)
          return yield* mismatch("custom", reply);
        const [next, entries] = value.values;
        if (next === undefined || entries === undefined) return yield* mismatch("custom", reply);
        return { cursor: yield* simpleText(next), entries: yield* array(blob)(entries) };
      }),
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      const token = yield* parse(Schema.NonEmptyString, cursor);
      return {
        tokens: [
          "CLUSTERSCAN",
          token,
          ...(selected.match === undefined ? [] : ["MATCH", selected.match]),
          ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
          ...(selected.type === undefined ? [] : ["TYPE", selected.type]),
          ...(selected.slot === undefined ? [] : ["SLOT", String(selected.slot)]),
        ] as const,
        routing: {
          _tag: "Slot" as const,
          slot: token === "0" ? (selected.slot ?? 0) : keySlot(token),
        },
      };
    }),
  );
