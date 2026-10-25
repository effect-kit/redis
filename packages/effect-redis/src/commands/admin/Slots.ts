import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { nodeCommand } from "#/commands/admin/Build";
import { parse } from "#/commands/internal/Input";
import { ScriptFlushMode } from "#/commands/scripting/Script";

const Slot = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16383 }));
const Range = Schema.Tuple([Slot, Slot]).check(Schema.makeFilter(([start, end]) => start <= end));

/** Experimental slot-local deletion; stock Redis 8.10.2 excludes this command at generation. */
export const flushSlots = (
  ranges: readonly [readonly [number, number], ...Array<readonly [number, number]>],
  mode?: ScriptFlushMode,
) =>
  nodeCommand(
    "SFLUSH",
    array(tuple(unsigned, unsigned)),
    Effect.gen(function* () {
      const selected = yield* parse(Schema.NonEmptyArray(Range), ranges);
      const flushMode = yield* parse(Schema.optional(ScriptFlushMode), mode);

      return [
        ...selected.flatMap(([start, end]) => [String(start), String(end)]),
        ...(flushMode === undefined ? [] : [flushMode]),
      ];
    }),
    undefined,
    [
      "Experimental metadata since Redis8.0; excluded by stock8.10.2 command generation; actual server availability applies",
    ],
  );
