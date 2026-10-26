import { Effect, Schema } from "effect";

import { status } from "#/command/reply/Scalars";
import { nodeCommand } from "#/commands/admin/Build";
import { Slot, Slots, rangeTokens } from "#/commands/cluster/Build";
import type { SlotRanges } from "#/commands/cluster/Build";
import { Argument, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const clusterAddSlots = (slots: readonly [number, ...number[]]) =>
  nodeCommand(
    "CLUSTER ADDSLOTS",
    status("OK"),
    parse(Slots, slots).pipe(Effect.map((values) => values.map(String))),
  );
export const clusterDelSlots = (slots: readonly [number, ...number[]]) =>
  nodeCommand(
    "CLUSTER DELSLOTS",
    status("OK"),
    parse(Slots, slots).pipe(Effect.map((values) => values.map(String))),
  );
export const clusterAddSlotRanges = (ranges: SlotRanges) =>
  nodeCommand("CLUSTER ADDSLOTSRANGE", status("OK"), rangeTokens(ranges));
export const clusterDelSlotRanges = (ranges: SlotRanges) =>
  nodeCommand("CLUSTER DELSLOTSRANGE", status("OK"), rangeTokens(ranges));
export const clusterFlushSlots = () => nodeCommand("CLUSTER FLUSHSLOTS", status("OK"));
export const clusterFlushSlot = (slot: number, mode?: "SYNC" | "ASYNC") =>
  nodeCommand(
    "CLUSTER FLUSHSLOT",
    status("OK"),
    Effect.gen(function* () {
      return [
        String(yield* parse(Slot, slot)),
        ...(mode === undefined ? [] : [yield* parse(Schema.Literals(["SYNC", "ASYNC"]), mode)]),
      ];
    }),
  );
export const clusterForget = (node: RedisArgument) =>
  nodeCommand("CLUSTER FORGET", status("OK"), parse(Argument, node).pipe(Effect.map((id) => [id])));
export const clusterReplicate = (node: RedisArgument) =>
  nodeCommand(
    "CLUSTER REPLICATE",
    status("OK"),
    parse(Argument, node).pipe(Effect.map((id) => [id])),
  );
export const clusterSaveConfig = () => nodeCommand("CLUSTER SAVECONFIG", status("OK"));
export const clusterSetConfigEpoch = (epoch: Integer) =>
  nodeCommand(
    "CLUSTER SET-CONFIG-EPOCH",
    status("OK"),
    parse(NonNegative, epoch).pipe(Effect.map((value) => [String(value)])),
  );
export const clusterReset = (mode?: "HARD" | "SOFT") =>
  nodeCommand(
    "CLUSTER RESET",
    status("OK"),
    mode === undefined
      ? Effect.succeed([])
      : parse(Schema.Literals(["HARD", "SOFT"]), mode).pipe(Effect.map((value) => [value])),
  );
export const clusterFailover = (mode?: "FORCE" | "TAKEOVER") =>
  nodeCommand(
    "CLUSTER FAILOVER",
    status("OK"),
    mode === undefined
      ? Effect.succeed([])
      : parse(Schema.Literals(["FORCE", "TAKEOVER"]), mode).pipe(Effect.map((value) => [value])),
  );

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
export const clusterMeet = (host: string, port: number, busPort?: number) =>
  nodeCommand(
    "CLUSTER MEET",
    status("OK"),
    Effect.gen(function* () {
      return [
        yield* parse(Schema.NonEmptyString, host),
        String(yield* parse(Port, port)),
        ...(busPort === undefined ? [] : [String(yield* parse(Port, busPort))]),
      ];
    }),
  );

const State = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("STABLE") }),
  Schema.Struct({ mode: Schema.Literals(["IMPORTING", "MIGRATING", "NODE"]), node: Argument }),
]);
export type ClusterSlotState = typeof State.Type;

export const clusterSetSlot = (slot: number, state: ClusterSlotState) =>
  nodeCommand(
    "CLUSTER SETSLOT",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(State, state);
      return [
        String(yield* parse(Slot, slot)),
        selected.mode,
        ...("node" in selected ? [selected.node] : []),
      ];
    }),
  );
