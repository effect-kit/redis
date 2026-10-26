import type { PayloadCodec } from "#/codecs/PayloadCodec";
import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/upstash/index";
import type { RedisArgument } from "#/RedisArgument";

export const upstashFamily = (executor: RedisExecutor) => ({
  searchCreate: (...args: Parameters<typeof Commands.searchCreate>) =>
    executor.execute(Commands.searchCreate(...args)),
  searchDrop: (...args: Parameters<typeof Commands.searchDrop>) =>
    executor.execute(Commands.searchDrop(...args)),
  searchDescribe: (...args: Parameters<typeof Commands.searchDescribe>) =>
    executor.execute(Commands.searchDescribe(...args)),
  searchWaitIndexing: (...args: Parameters<typeof Commands.searchWaitIndexing>) =>
    executor.execute(Commands.searchWaitIndexing(...args)),
  searchListIndexes: (...args: Parameters<typeof Commands.searchListIndexes>) =>
    executor.execute(Commands.searchListIndexes(...args)),
  searchAliasAdd: (...args: Parameters<typeof Commands.searchAliasAdd>) =>
    executor.execute(Commands.searchAliasAdd(...args)),
  searchAliasDel: (...args: Parameters<typeof Commands.searchAliasDel>) =>
    executor.execute(Commands.searchAliasDel(...args)),
  searchListAliases: () => executor.execute(Commands.searchListAliases()),
  searchCount: (...args: Parameters<typeof Commands.searchCount>) =>
    executor.execute(Commands.searchCount(...args)),
  searchAggregate: (...args: Parameters<typeof Commands.searchAggregate>) =>
    executor.execute(Commands.searchAggregate(...args)),
  searchQuery: (...args: Parameters<typeof Commands.searchQuery>) =>
    executor.execute(Commands.searchQuery(...args)),
  searchQueryKeys: (...args: Parameters<typeof Commands.searchQueryKeys>) =>
    executor.execute(Commands.searchQueryKeys(...args)),
  searchQueryWith: <A, RD, RE>(
    name: RedisArgument,
    filter: Commands.JsonObjectArgument,
    codec: PayloadCodec<A, RD, RE>,
    options?: Omit<Commands.SearchQueryOptions, "select" | "highlight">,
  ) => executor.execute(Commands.searchQueryWith(name, filter, codec, options)),

  vectorCreate: (...args: Parameters<typeof Commands.vectorCreate>) =>
    executor.execute(Commands.vectorCreate(...args)),
  vectorAdd: (...args: Parameters<typeof Commands.vectorAdd>) =>
    executor.execute(Commands.vectorAdd(...args)),
  vectorGet: (...args: Parameters<typeof Commands.vectorGet>) =>
    executor.execute(Commands.vectorGet(...args)),
  vectorDel: (...args: Parameters<typeof Commands.vectorDel>) =>
    executor.execute(Commands.vectorDel(...args)),
  vectorCount: (...args: Parameters<typeof Commands.vectorCount>) =>
    executor.execute(Commands.vectorCount(...args)),
  vectorDrop: (...args: Parameters<typeof Commands.vectorDrop>) =>
    executor.execute(Commands.vectorDrop(...args)),
  vectorInfo: (...args: Parameters<typeof Commands.vectorInfo>) =>
    executor.execute(Commands.vectorInfo(...args)),
  vectorQuery: (...args: Parameters<typeof Commands.vectorQuery>) =>
    executor.execute(Commands.vectorQuery(...args)),

  aclRestToken: (...args: Parameters<typeof Commands.aclRestToken>) =>
    executor.execute(Commands.aclRestToken(...args)),
});
