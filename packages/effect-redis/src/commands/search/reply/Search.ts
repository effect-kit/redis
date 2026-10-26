import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, tuple, unsigned } from "#/command/reply/Data";
import { blob, mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { losslessValue, moduleDouble } from "#/commands/modules/Reply";
import type { SearchOptions } from "#/commands/search/query/Options";
import { searchFields } from "#/commands/search/reply/Fields";
import type { SearchFields } from "#/commands/search/reply/Fields";
import type { RespValue } from "#/protocol/RespValue";

export interface SearchScore {
  readonly value: number;
  readonly explanation: Option.Option<RespValue>;
}
export interface SearchDocument {
  readonly id: Uint8Array;
  readonly fields: Option.Option<SearchFields>;
  readonly score: Option.Option<SearchScore>;
  readonly payload: Option.Option<Uint8Array>;
  readonly sortKey: Option.Option<Uint8Array>;
  readonly metadata: ReadonlyArray<readonly [string, RespValue]>;
}
export interface SearchResult {
  readonly total: bigint;
  readonly documents: ReadonlyArray<SearchDocument>;
  readonly metadata: ReadonlyArray<readonly [string, RespValue]>;
}
const score: ReplyDecoder<SearchScore> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "Array"
    ? tuple(
        moduleDouble,
        losslessValue,
      )(reply).pipe(
        Effect.map(([decoded, explanation]) => ({
          value: decoded,
          explanation: Option.some(explanation),
        })),
      )
    : moduleDouble(reply).pipe(
        Effect.map((decoded) => ({ value: decoded, explanation: Option.none() })),
      );
};
const nativeDocument: ReplyDecoder<SearchDocument> = (reply) =>
  Effect.gen(function* () {
    const report = yield* fields(reply);
    const get = (name: string) => report.find(([key]) => key === name)?.[1];
    const id = get("id");
    if (id === undefined) return yield* mismatch("custom", reply);
    const content = get("extra_attributes");
    const scoreReply = get("score");
    const payload = get("payload");
    const sortKey = get("sortkey");

    return {
      id: yield* blob(id),
      fields: content === undefined ? Option.none() : yield* nullable(searchFields)(content),
      score: scoreReply === undefined ? Option.none() : yield* nullable(score)(scoreReply),
      payload: payload === undefined ? Option.none() : yield* nullable(blob)(payload),
      sortKey: sortKey === undefined ? Option.none() : yield* nullable(blob)(sortKey),
      metadata: report.filter(
        ([key]) => !["id", "extra_attributes", "score", "payload", "sortkey"].includes(key),
      ),
    };
  });

export const searchResult = (
  options: Pick<SearchOptions, "noContent" | "withScores" | "withPayloads" | "withSortKeys">,
): ReplyDecoder<SearchResult> => {
  const { noContent, withScores, withPayloads, withSortKeys } = options;
  return (reply) =>
    Effect.gen(function* () {
      const value = undecorate(reply);
      if (value._tag === "Map") {
        const report = yield* fields(value);
        const total = report.find(([key]) => key === "total_results")?.[1];
        const documents = report.find(([key]) => key === "results")?.[1];
        if (total === undefined || documents === undefined) return yield* mismatch("custom", reply);
        return {
          total: yield* unsigned(total),
          documents: yield* array(nativeDocument)(documents),
          metadata: report.filter(([key]) => !["total_results", "results"].includes(key)),
        };
      }
      if (value._tag !== "Array") return yield* mismatch("array", reply);
      const [total, ...tail] = value.values;
      const stride =
        1 +
        (withScores ? 1 : 0) +
        (withPayloads ? 1 : 0) +
        (withSortKeys ? 1 : 0) +
        (noContent ? 0 : 1);
      if (total === undefined || tail.length % stride !== 0)
        return yield* mismatch("array-length", reply);
      const documents: SearchDocument[] = [];

      for (let index = 0; index < tail.length; index += stride) {
        const id = tail[index];
        if (id === undefined) return yield* mismatch("array", reply);
        let cursor = index + 1;
        const scoreReply = withScores ? tail[cursor++] : undefined;
        const payload = withPayloads ? tail[cursor++] : undefined;
        const sortKey = withSortKeys ? tail[cursor++] : undefined;
        const content = noContent ? undefined : tail[cursor];
        if (
          (!noContent && content === undefined) ||
          (withScores && scoreReply === undefined) ||
          (withPayloads && payload === undefined) ||
          (withSortKeys && sortKey === undefined)
        )
          return yield* mismatch("array-length", reply);

        documents.push({
          id: yield* blob(id),
          fields: content === undefined ? Option.none() : yield* nullable(searchFields)(content),
          score: scoreReply === undefined ? Option.none() : Option.some(yield* score(scoreReply)),
          payload: payload === undefined ? Option.none() : yield* nullable(blob)(payload),
          sortKey: sortKey === undefined ? Option.none() : yield* nullable(blob)(sortKey),
          metadata: [],
        });
      }
      return { total: yield* unsigned(total), documents, metadata: [] };
    });
};
