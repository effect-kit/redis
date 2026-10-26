import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { tuple } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { parse } from "#/commands/internal/Input";
import { moduleKeyless } from "#/commands/modules/Build";
import { losslessValue } from "#/commands/modules/Reply";
import { aggregateTokens } from "#/commands/search/query/Aggregate";
import type { SearchAggregateOptions } from "#/commands/search/query/Aggregate";
import { searchTokens } from "#/commands/search/query/Options";
import type { SearchOptions } from "#/commands/search/query/Options";
import { aggregateResult } from "#/commands/search/reply/Aggregate";
import { searchResult } from "#/commands/search/reply/Search";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

export interface SearchProfile<A> {
  readonly result: A;
  readonly profile: RespValue;
}
export const profileResult =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<SearchProfile<A>> =>
  (reply) =>
    Effect.gen(function* () {
      const value = undecorate(reply);
      if (value._tag !== "Map") {
        const [result, profile] = yield* tuple(decode, losslessValue)(value);
        return { result, profile };
      }
      const report = yield* fields(value);
      const result = report.find(([key]) => key === "Results")?.[1];
      const profile = report.find(([key]) => key === "Profile" || key === "profile")?.[1];
      // Search2.10 appends lowercase profile to the result map; Search8.10 nests Results separately.
      if (
        result === undefined &&
        profile !== undefined &&
        report.some(([key]) => key === "total_results")
      )
        return { result: yield* decode(value), profile };
      if (result === undefined || profile === undefined) return yield* mismatch("custom", reply);
      return { result: yield* decode(result), profile };
    });
const limited = (options: { readonly limited?: boolean }) =>
  parse(Schema.Struct({ limited: Schema.optionalKey(Schema.Boolean) }), options).pipe(
    Effect.map((selected) => (selected.limited ? ["LIMITED"] : [])),
  );
export const ftProfileSearch = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchOptions = {},
  profile: { readonly limited?: boolean } = {},
) => ({
  prepare: Effect.gen(function* () {
    const { selected, tokens } = yield* searchTokens(options);
    const flags = yield* limited(profile);
    return yield* moduleKeyless(
      "search",
      "FT.PROFILE",
      profileResult(searchResult(selected)),
      Effect.succeed([index, "SEARCH", ...flags, "QUERY", query, ...tokens]),
    ).prepare;
  }),
});
export const ftProfileAggregate = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchAggregateOptions = {},
  profile: { readonly limited?: boolean } = {},
) =>
  moduleKeyless(
    "search",
    "FT.PROFILE",
    profileResult(aggregateResult),
    Effect.gen(function* () {
      return [
        index,
        "AGGREGATE",
        ...(yield* limited(profile)),
        "QUERY",
        query,
        ...(yield* aggregateTokens(options)),
      ];
    }),
  );
