import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { searchFields } from "#/commands/search/reply/Fields";
import type { SearchFields } from "#/commands/search/reply/Fields";
import type { RespValue } from "#/protocol/RespValue";

export interface SearchAggregateResult {
  /** Server count for this receipt; it is not a snapshot cardinality across cursor pages. */
  readonly total: bigint;
  readonly rows: ReadonlyArray<SearchFields>;
  readonly metadata: ReadonlyArray<readonly [string, RespValue]>;
}

const nativeRow: ReplyDecoder<SearchFields> = (reply) =>
  Effect.gen(function* () {
    const report = yield* fields(reply);
    const content = report.find(([key]) => key === "extra_attributes")?.[1];
    if (content === undefined) return yield* mismatch("custom", reply);

    return yield* searchFields(content);
  });

export const aggregateResult: ReplyDecoder<SearchAggregateResult> = (reply) =>
  Effect.gen(function* () {
    const value = undecorate(reply);
    if (value._tag === "Map") {
      const report = yield* fields(value);
      const total = report.find(([key]) => key === "total_results")?.[1];
      const rows = report.find(([key]) => key === "results")?.[1];
      if (total === undefined || rows === undefined) return yield* mismatch("custom", reply);

      return {
        total: yield* unsigned(total),
        rows: yield* array(nativeRow)(rows),
        metadata: report.filter(([key]) => !["results", "total_results"].includes(key)),
      };
    }
    if (value._tag !== "Array") return yield* mismatch("array", reply);
    const [total, ...rows] = value.values;
    if (total === undefined) return yield* mismatch("array", reply);

    return {
      total: yield* unsigned(total),
      rows: yield* Effect.forEach(rows, searchFields),
      metadata: [],
    };
  });

export const aggregateCursor = (reply: RespValue) =>
  tuple(aggregateResult, unsigned)(reply).pipe(Effect.map(([page, cursor]) => ({ page, cursor })));
