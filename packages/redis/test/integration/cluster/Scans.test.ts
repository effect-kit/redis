import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { bytes, sent } from "#test/support/connection/Controlled";

it.effect("global scan reports topology replacement even when the last page is empty", () =>
  Effect.gen(function* () {
    const { client, seed, a } = yield* clusterControlled();
    const scan = yield* Effect.forkChild(Effect.result(client.scanKeys().pipe(Stream.runCollect)));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["SCAN", "0"]);

    const refresh = yield* Effect.forkChild(client.refresh);
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("b", "node-b"));
    yield* Fiber.join(refresh);
    yield* a.receive(bytes("*2\r\n$1\r\n0\r\n*0\r\n"));

    expect(yield* Fiber.join(scan)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ClusterError", reason: "topology-changed", delivery: "replied" },
    });
  }),
);
