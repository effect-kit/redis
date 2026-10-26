export { ftCreate, ftAlter, ftDropindex, ftInfo, ftList } from "#/commands/search/index/Lifecycle";
export {
  ftAliasadd,
  ftAliasupdate,
  ftAliasdel,
  ftAliaslist,
  ftDictadd,
  ftDictdel,
  ftDictdump,
  ftSynupdate,
  ftSyndump,
  ftTagvals,
  ftExplain,
  ftExplaincli,
  ftGet,
  ftMget,
  ftConfigHelp,
  ftConfigGet,
  ftConfigSet,
} from "#/commands/search/index/Controls";
export { ftAdd, ftSafeadd, ftDel, ftDrop } from "#/commands/search/index/Legacy";
export { ftSearch } from "#/commands/search/query/Search";
export {
  ftAggregate,
  ftAggregateWithCursor,
  ftCursorRead,
  ftCursorDel,
} from "#/commands/search/query/Aggregate";
export { ftProfileSearch, ftProfileAggregate } from "#/commands/search/query/Profile";
export { ftHybrid, ftProfileHybrid } from "#/commands/search/query/Hybrid";
export { ftSpellcheck } from "#/commands/search/Spelling";
export {
  ftSugadd,
  ftSugdel,
  ftSuglen,
  ftSugget,
  ftSuggetWithScores,
  ftSuggetWithPayloads,
  ftSuggetWithScoresAndPayloads,
} from "#/commands/search/Suggestions";
