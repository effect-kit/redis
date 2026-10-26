import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/probabilistic/index";

export const probabilisticFamily = (executor: RedisExecutor) => ({
  bfAdd: (...args: Parameters<typeof Commands.bfAdd>) => executor.execute(Commands.bfAdd(...args)),

  bfCard: (...args: Parameters<typeof Commands.bfCard>) =>
    executor.execute(Commands.bfCard(...args)),

  bfExists: (...args: Parameters<typeof Commands.bfExists>) =>
    executor.execute(Commands.bfExists(...args)),

  bfInfo: (...args: Parameters<typeof Commands.bfInfo>) =>
    executor.execute(Commands.bfInfo(...args)),

  bfInfoValue: (...args: Parameters<typeof Commands.bfInfoValue>) =>
    executor.execute(Commands.bfInfoValue(...args)),

  bfInsert: (...args: Parameters<typeof Commands.bfInsert>) =>
    executor.execute(Commands.bfInsert(...args)),

  bfLoadchunk: (...args: Parameters<typeof Commands.bfLoadchunk>) =>
    executor.execute(Commands.bfLoadchunk(...args)),

  bfMadd: (...args: Parameters<typeof Commands.bfMadd>) =>
    executor.execute(Commands.bfMadd(...args)),

  bfMexists: (...args: Parameters<typeof Commands.bfMexists>) =>
    executor.execute(Commands.bfMexists(...args)),

  bfReserve: (...args: Parameters<typeof Commands.bfReserve>) =>
    executor.execute(Commands.bfReserve(...args)),

  bfScandump: (...args: Parameters<typeof Commands.bfScandump>) =>
    executor.execute(Commands.bfScandump(...args)),

  cfAdd: (...args: Parameters<typeof Commands.cfAdd>) => executor.execute(Commands.cfAdd(...args)),

  cfAddnx: (...args: Parameters<typeof Commands.cfAddnx>) =>
    executor.execute(Commands.cfAddnx(...args)),

  cfCount: (...args: Parameters<typeof Commands.cfCount>) =>
    executor.execute(Commands.cfCount(...args)),

  cfDel: (...args: Parameters<typeof Commands.cfDel>) => executor.execute(Commands.cfDel(...args)),

  cfExists: (...args: Parameters<typeof Commands.cfExists>) =>
    executor.execute(Commands.cfExists(...args)),

  cfInfo: (...args: Parameters<typeof Commands.cfInfo>) =>
    executor.execute(Commands.cfInfo(...args)),

  cfInsert: (...args: Parameters<typeof Commands.cfInsert>) =>
    executor.execute(Commands.cfInsert(...args)),

  cfInsertnx: (...args: Parameters<typeof Commands.cfInsertnx>) =>
    executor.execute(Commands.cfInsertnx(...args)),

  cfLoadchunk: (...args: Parameters<typeof Commands.cfLoadchunk>) =>
    executor.execute(Commands.cfLoadchunk(...args)),

  cfMexists: (...args: Parameters<typeof Commands.cfMexists>) =>
    executor.execute(Commands.cfMexists(...args)),

  cfReserve: (...args: Parameters<typeof Commands.cfReserve>) =>
    executor.execute(Commands.cfReserve(...args)),

  cfScandump: (...args: Parameters<typeof Commands.cfScandump>) =>
    executor.execute(Commands.cfScandump(...args)),

  cmsIncrby: (...args: Parameters<typeof Commands.cmsIncrby>) =>
    executor.execute(Commands.cmsIncrby(...args)),

  cmsInfo: (...args: Parameters<typeof Commands.cmsInfo>) =>
    executor.execute(Commands.cmsInfo(...args)),

  cmsInitbydim: (...args: Parameters<typeof Commands.cmsInitbydim>) =>
    executor.execute(Commands.cmsInitbydim(...args)),

  cmsInitbyprob: (...args: Parameters<typeof Commands.cmsInitbyprob>) =>
    executor.execute(Commands.cmsInitbyprob(...args)),

  cmsMerge: (...args: Parameters<typeof Commands.cmsMerge>) =>
    executor.execute(Commands.cmsMerge(...args)),

  cmsQuery: (...args: Parameters<typeof Commands.cmsQuery>) =>
    executor.execute(Commands.cmsQuery(...args)),

  tdigestAdd: (...args: Parameters<typeof Commands.tdigestAdd>) =>
    executor.execute(Commands.tdigestAdd(...args)),

  tdigestByrank: (...args: Parameters<typeof Commands.tdigestByrank>) =>
    executor.execute(Commands.tdigestByrank(...args)),

  tdigestByrevrank: (...args: Parameters<typeof Commands.tdigestByrevrank>) =>
    executor.execute(Commands.tdigestByrevrank(...args)),

  tdigestCdf: (...args: Parameters<typeof Commands.tdigestCdf>) =>
    executor.execute(Commands.tdigestCdf(...args)),

  tdigestCreate: (...args: Parameters<typeof Commands.tdigestCreate>) =>
    executor.execute(Commands.tdigestCreate(...args)),

  tdigestInfo: (...args: Parameters<typeof Commands.tdigestInfo>) =>
    executor.execute(Commands.tdigestInfo(...args)),

  tdigestMax: (...args: Parameters<typeof Commands.tdigestMax>) =>
    executor.execute(Commands.tdigestMax(...args)),

  tdigestMerge: (...args: Parameters<typeof Commands.tdigestMerge>) =>
    executor.execute(Commands.tdigestMerge(...args)),

  tdigestMin: (...args: Parameters<typeof Commands.tdigestMin>) =>
    executor.execute(Commands.tdigestMin(...args)),

  tdigestQuantile: (...args: Parameters<typeof Commands.tdigestQuantile>) =>
    executor.execute(Commands.tdigestQuantile(...args)),

  tdigestRank: (...args: Parameters<typeof Commands.tdigestRank>) =>
    executor.execute(Commands.tdigestRank(...args)),

  tdigestReset: (...args: Parameters<typeof Commands.tdigestReset>) =>
    executor.execute(Commands.tdigestReset(...args)),

  tdigestRevrank: (...args: Parameters<typeof Commands.tdigestRevrank>) =>
    executor.execute(Commands.tdigestRevrank(...args)),

  tdigestTrimmedMean: (...args: Parameters<typeof Commands.tdigestTrimmedMean>) =>
    executor.execute(Commands.tdigestTrimmedMean(...args)),

  topkAdd: (...args: Parameters<typeof Commands.topkAdd>) =>
    executor.execute(Commands.topkAdd(...args)),

  topkCount: (...args: Parameters<typeof Commands.topkCount>) =>
    executor.execute(Commands.topkCount(...args)),

  topkIncrby: (...args: Parameters<typeof Commands.topkIncrby>) =>
    executor.execute(Commands.topkIncrby(...args)),

  topkInfo: (...args: Parameters<typeof Commands.topkInfo>) =>
    executor.execute(Commands.topkInfo(...args)),

  topkList: (...args: Parameters<typeof Commands.topkList>) =>
    executor.execute(Commands.topkList(...args)),

  topkListWithCount: (...args: Parameters<typeof Commands.topkListWithCount>) =>
    executor.execute(Commands.topkListWithCount(...args)),

  topkQuery: (...args: Parameters<typeof Commands.topkQuery>) =>
    executor.execute(Commands.topkQuery(...args)),

  topkReserve: (...args: Parameters<typeof Commands.topkReserve>) =>
    executor.execute(Commands.topkReserve(...args)),
  bfInfoExpansion: (...args: Parameters<typeof Commands.bfInfoExpansion>) =>
    executor.execute(Commands.bfInfoExpansion(...args)),

  bfDebug: (...args: Parameters<typeof Commands.bfDebug>) =>
    executor.execute(Commands.bfDebug(...args)),

  cfDebug: (...args: Parameters<typeof Commands.cfDebug>) =>
    executor.execute(Commands.cfDebug(...args)),

  cfCompact: (...args: Parameters<typeof Commands.cfCompact>) =>
    executor.execute(Commands.cfCompact(...args)),
});
