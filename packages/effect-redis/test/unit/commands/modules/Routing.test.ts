import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { commandSlot, replicaEligible as clusterReplica } from "#/cluster/routing/Route";
import { decodeReply } from "#/command/Decode";
import { Commands, keySlot } from "#/index";
import { replicaEligible as sentinelReplica } from "#/sentinel/execution/Validation";

it.effect("module dumps remain primary-bound even under explicit stale-read preferences", () =>
  Effect.gen(function* () {
    for (const command of [Commands.bfScandump("filter", 0), Commands.cfScandump("filter", 0)]) {
      const prepared = yield* command.prepare;
      expect(clusterReplica(prepared)).toBe(false);
      expect(sentinelReplica(prepared)).toBe(false);
    }
    const read = yield* Commands.bfExists("filter", "member").prepare;
    expect(clusterReplica(read)).toBe(true);
    expect(sentinelReplica(read)).toBe(true);
    expect(clusterReplica(yield* Commands.cfCompact("filter").prepare)).toBe(false);
  }),
);

it.effect(
  "module global state requires explicit Cluster targets while declared keys enforce slots",
  () =>
    Effect.gen(function* () {
      for (const command of [Commands.ftList(), Commands.tsQueryindex(["env=prod"])]) {
        const prepared = yield* command.prepare;
        expect(yield* Effect.flip(commandSlot(prepared))).toMatchObject({
          _tag: "ClusterError",
          reason: "explicit-target-required",
        });
        expect(yield* commandSlot(prepared, true)).toBeUndefined();
      }
      const same = yield* Commands.jsonMget(["{one}:a", "{one}:b"], ".").prepare;
      expect(yield* commandSlot(same)).toBe(keySlot("{one}:a"));
      const different = yield* Commands.tsMadd([
        ["{one}:a", 1, 2],
        ["{two}:b", 1, 2],
      ]).prepare;
      expect(yield* Effect.flip(commandSlot(different))).toMatchObject({
        reason: "cross-slot",
        delivery: "unsent",
      });
    }),
);

it.effect("Bloom INFO selectors accept reviewed wrappers and reject wrong field reports", () =>
  Effect.gen(function* () {
    const command = yield* Commands.bfInfoValue("filter", "CAPACITY").prepare;
    expect(
      yield* decodeReply(command, { _tag: "Array", values: [{ _tag: "Integer", value: 100n }] }),
    ).toBe(100n);
    expect(yield* decodeReply(command, { _tag: "Integer", value: 100n })).toBe(100n);
    expect(
      yield* decodeReply(command, {
        _tag: "Map",
        entries: [
          [
            { _tag: "SimpleString", value: new TextEncoder().encode("Capacity") },
            { _tag: "Integer", value: 100n },
          ],
        ],
      }),
    ).toBe(100n);
    const wrongField = yield* Effect.flip(
      decodeReply(command, {
        _tag: "Map",
        entries: [
          [
            { _tag: "SimpleString", value: new TextEncoder().encode("Size") },
            { _tag: "Integer", value: 100n },
          ],
        ],
      }),
    );
    expect(wrongField._tag).toBe("ReplyError");
  }),
);
