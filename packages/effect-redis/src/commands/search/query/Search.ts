import { Effect } from "effect";

import { moduleKeyless } from "#/commands/modules/Build";
import { searchTokens } from "#/commands/search/query/Options";
import type { SearchOptions } from "#/commands/search/query/Options";
import { searchResult } from "#/commands/search/reply/Search";
import type { RedisArgument } from "#/RedisArgument";

export const ftSearch = (
  index: RedisArgument,
  query: RedisArgument,
  options: SearchOptions = {},
) => ({
  prepare: Effect.gen(function* () {
    const { selected, tokens } = yield* searchTokens(options);
    // Reply width follows the validated preparation snapshot, never a later mutation of caller options.
    return yield* moduleKeyless(
      "search",
      "FT.SEARCH",
      searchResult(selected),
      Effect.succeed([index, query, ...tokens]),
    ).prepare;
  }),
});
