import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { keySlot } from "#/cluster/Slot";
import { clusterScan } from "#/commands/cluster/Scan";
import { clusterArray as array, clusterText as text } from "#test/support/commands/ClusterValues";

it.effect("preserves Valkey's opaque tagged cursor and routes initial explicit SLOT", () =>
  Effect.gen(function* () {
    const initial = yield* clusterScan("0", { slot: 12182, count: 3, match: "a*", type: "string" })
      .prepare;
    expect(initial.tokens).toEqual([
      "CLUSTERSCAN",
      "0",
      "MATCH",
      "a*",
      "COUNT",
      "3",
      "TYPE",
      "string",
      "SLOT",
      "12182",
    ]);
    expect(initial.routing).toEqual({ _tag: "Slot", slot: 12182 });

    const token = "fingerprint-{foo}-9007199254740993";
    const continuation = yield* clusterScan(token).prepare;
    expect(continuation.routing).toEqual({ _tag: "Slot", slot: keySlot("foo") });
    expect(yield* continuation.decode(array(text(token), array(text("key"))))).toEqual({
      cursor: token,
      entries: [new TextEncoder().encode("key")],
    });
  }),
);
