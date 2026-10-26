import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/search/index";

export const searchFamily = (executor: RedisExecutor) => ({
  ftConfigHelp: (...args: Parameters<typeof Commands.ftConfigHelp>) =>
    executor.execute(Commands.ftConfigHelp(...args)),

  ftCreate: (...args: Parameters<typeof Commands.ftCreate>) =>
    executor.execute(Commands.ftCreate(...args)),

  ftAlter: (...args: Parameters<typeof Commands.ftAlter>) =>
    executor.execute(Commands.ftAlter(...args)),

  ftDropindex: (...args: Parameters<typeof Commands.ftDropindex>) =>
    executor.execute(Commands.ftDropindex(...args)),

  ftInfo: (...args: Parameters<typeof Commands.ftInfo>) =>
    executor.execute(Commands.ftInfo(...args)),

  ftList: (...args: Parameters<typeof Commands.ftList>) =>
    executor.execute(Commands.ftList(...args)),

  ftAliasadd: (...args: Parameters<typeof Commands.ftAliasadd>) =>
    executor.execute(Commands.ftAliasadd(...args)),

  ftAliasupdate: (...args: Parameters<typeof Commands.ftAliasupdate>) =>
    executor.execute(Commands.ftAliasupdate(...args)),

  ftAliasdel: (...args: Parameters<typeof Commands.ftAliasdel>) =>
    executor.execute(Commands.ftAliasdel(...args)),

  ftAliaslist: (...args: Parameters<typeof Commands.ftAliaslist>) =>
    executor.execute(Commands.ftAliaslist(...args)),

  ftDictadd: (...args: Parameters<typeof Commands.ftDictadd>) =>
    executor.execute(Commands.ftDictadd(...args)),

  ftDictdel: (...args: Parameters<typeof Commands.ftDictdel>) =>
    executor.execute(Commands.ftDictdel(...args)),

  ftDictdump: (...args: Parameters<typeof Commands.ftDictdump>) =>
    executor.execute(Commands.ftDictdump(...args)),

  ftSynupdate: (...args: Parameters<typeof Commands.ftSynupdate>) =>
    executor.execute(Commands.ftSynupdate(...args)),

  ftSyndump: (...args: Parameters<typeof Commands.ftSyndump>) =>
    executor.execute(Commands.ftSyndump(...args)),

  ftTagvals: (...args: Parameters<typeof Commands.ftTagvals>) =>
    executor.execute(Commands.ftTagvals(...args)),

  ftExplain: (...args: Parameters<typeof Commands.ftExplain>) =>
    executor.execute(Commands.ftExplain(...args)),

  ftExplaincli: (...args: Parameters<typeof Commands.ftExplaincli>) =>
    executor.execute(Commands.ftExplaincli(...args)),

  ftGet: (...args: Parameters<typeof Commands.ftGet>) => executor.execute(Commands.ftGet(...args)),

  ftMget: (...args: Parameters<typeof Commands.ftMget>) =>
    executor.execute(Commands.ftMget(...args)),

  ftConfigGet: (...args: Parameters<typeof Commands.ftConfigGet>) =>
    executor.execute(Commands.ftConfigGet(...args)),

  ftConfigSet: (...args: Parameters<typeof Commands.ftConfigSet>) =>
    executor.execute(Commands.ftConfigSet(...args)),

  ftAdd: (...args: Parameters<typeof Commands.ftAdd>) => executor.execute(Commands.ftAdd(...args)),

  ftSafeadd: (...args: Parameters<typeof Commands.ftSafeadd>) =>
    executor.execute(Commands.ftSafeadd(...args)),

  ftDel: (...args: Parameters<typeof Commands.ftDel>) => executor.execute(Commands.ftDel(...args)),

  ftDrop: (...args: Parameters<typeof Commands.ftDrop>) =>
    executor.execute(Commands.ftDrop(...args)),

  ftSearch: (...args: Parameters<typeof Commands.ftSearch>) =>
    executor.execute(Commands.ftSearch(...args)),

  ftAggregate: (...args: Parameters<typeof Commands.ftAggregate>) =>
    executor.execute(Commands.ftAggregate(...args)),

  ftAggregateWithCursor: (...args: Parameters<typeof Commands.ftAggregateWithCursor>) =>
    executor.execute(Commands.ftAggregateWithCursor(...args)),

  ftCursorRead: (...args: Parameters<typeof Commands.ftCursorRead>) =>
    executor.execute(Commands.ftCursorRead(...args)),

  ftCursorDel: (...args: Parameters<typeof Commands.ftCursorDel>) =>
    executor.execute(Commands.ftCursorDel(...args)),

  ftProfileSearch: (...args: Parameters<typeof Commands.ftProfileSearch>) =>
    executor.execute(Commands.ftProfileSearch(...args)),

  ftProfileAggregate: (...args: Parameters<typeof Commands.ftProfileAggregate>) =>
    executor.execute(Commands.ftProfileAggregate(...args)),

  ftHybrid: (...args: Parameters<typeof Commands.ftHybrid>) =>
    executor.execute(Commands.ftHybrid(...args)),

  ftProfileHybrid: (...args: Parameters<typeof Commands.ftProfileHybrid>) =>
    executor.execute(Commands.ftProfileHybrid(...args)),

  ftSpellcheck: (...args: Parameters<typeof Commands.ftSpellcheck>) =>
    executor.execute(Commands.ftSpellcheck(...args)),

  ftSugadd: (...args: Parameters<typeof Commands.ftSugadd>) =>
    executor.execute(Commands.ftSugadd(...args)),

  ftSugdel: (...args: Parameters<typeof Commands.ftSugdel>) =>
    executor.execute(Commands.ftSugdel(...args)),

  ftSuglen: (...args: Parameters<typeof Commands.ftSuglen>) =>
    executor.execute(Commands.ftSuglen(...args)),

  ftSugget: (...args: Parameters<typeof Commands.ftSugget>) =>
    executor.execute(Commands.ftSugget(...args)),

  ftSuggetWithScores: (...args: Parameters<typeof Commands.ftSuggetWithScores>) =>
    executor.execute(Commands.ftSuggetWithScores(...args)),

  ftSuggetWithPayloads: (...args: Parameters<typeof Commands.ftSuggetWithPayloads>) =>
    executor.execute(Commands.ftSuggetWithPayloads(...args)),

  ftSuggetWithScoresAndPayloads: (
    ...args: Parameters<typeof Commands.ftSuggetWithScoresAndPayloads>
  ) => executor.execute(Commands.ftSuggetWithScoresAndPayloads(...args)),
});
