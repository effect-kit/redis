import { Effect, Schema } from "effect";

import { parse } from "#/commands/internal/Input";

export const Slot = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16383 }));
export const Slots = Schema.NonEmptyArray(Slot);
export const SlotRange = Schema.Tuple([Slot, Slot]).check(
  Schema.makeFilter(([first, last]) => first <= last),
);
export const SlotRanges = Schema.NonEmptyArray(SlotRange);
export type SlotRanges = typeof SlotRanges.Type;

export const rangeTokens = (ranges: SlotRanges) =>
  parse(SlotRanges, ranges).pipe(
    Effect.map((selected) => selected.flatMap(([first, last]) => [String(first), String(last)])),
  );
