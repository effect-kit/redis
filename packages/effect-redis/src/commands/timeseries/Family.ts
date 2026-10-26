import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/timeseries/index";

export const timeSeriesFamily = (executor: RedisExecutor) => ({
  tsNrangeWithAggregations: (...args: Parameters<typeof Commands.tsNrangeWithAggregations>) =>
    executor.execute(Commands.tsNrangeWithAggregations(...args)),
  tsNrevrangeWithAggregations: (...args: Parameters<typeof Commands.tsNrevrangeWithAggregations>) =>
    executor.execute(Commands.tsNrevrangeWithAggregations(...args)),
  tsCreate: (...args: Parameters<typeof Commands.tsCreate>) =>
    executor.execute(Commands.tsCreate(...args)),

  tsAlter: (...args: Parameters<typeof Commands.tsAlter>) =>
    executor.execute(Commands.tsAlter(...args)),

  tsAdd: (...args: Parameters<typeof Commands.tsAdd>) => executor.execute(Commands.tsAdd(...args)),

  tsMadd: (...args: Parameters<typeof Commands.tsMadd>) =>
    executor.execute(Commands.tsMadd(...args)),

  tsIncrby: (...args: Parameters<typeof Commands.tsIncrby>) =>
    executor.execute(Commands.tsIncrby(...args)),

  tsDecrby: (...args: Parameters<typeof Commands.tsDecrby>) =>
    executor.execute(Commands.tsDecrby(...args)),

  tsDel: (...args: Parameters<typeof Commands.tsDel>) => executor.execute(Commands.tsDel(...args)),

  tsCreaterule: (...args: Parameters<typeof Commands.tsCreaterule>) =>
    executor.execute(Commands.tsCreaterule(...args)),

  tsDeleterule: (...args: Parameters<typeof Commands.tsDeleterule>) =>
    executor.execute(Commands.tsDeleterule(...args)),

  tsGet: (...args: Parameters<typeof Commands.tsGet>) => executor.execute(Commands.tsGet(...args)),

  tsInfo: (...args: Parameters<typeof Commands.tsInfo>) =>
    executor.execute(Commands.tsInfo(...args)),

  tsRange: (...args: Parameters<typeof Commands.tsRange>) =>
    executor.execute(Commands.tsRange(...args)),

  tsRevrange: (...args: Parameters<typeof Commands.tsRevrange>) =>
    executor.execute(Commands.tsRevrange(...args)),

  tsNrange: (...args: Parameters<typeof Commands.tsNrange>) =>
    executor.execute(Commands.tsNrange(...args)),

  tsNrevrange: (...args: Parameters<typeof Commands.tsNrevrange>) =>
    executor.execute(Commands.tsNrevrange(...args)),

  tsQueryindex: (...args: Parameters<typeof Commands.tsQueryindex>) =>
    executor.execute(Commands.tsQueryindex(...args)),

  tsQuerylabels: (...args: Parameters<typeof Commands.tsQuerylabels>) =>
    executor.execute(Commands.tsQuerylabels(...args)),

  tsQuerylabelValues: (...args: Parameters<typeof Commands.tsQuerylabelValues>) =>
    executor.execute(Commands.tsQuerylabelValues(...args)),

  tsMget: (...args: Parameters<typeof Commands.tsMget>) =>
    executor.execute(Commands.tsMget(...args)),

  tsMrange: (...args: Parameters<typeof Commands.tsMrange>) =>
    executor.execute(Commands.tsMrange(...args)),

  tsMrevrange: (...args: Parameters<typeof Commands.tsMrevrange>) =>
    executor.execute(Commands.tsMrevrange(...args)),

  tsRead: (...args: Parameters<typeof Commands.tsRead>) =>
    executor.execute(Commands.tsRead(...args)),
  tsRangeWithAggregations: (...args: Parameters<typeof Commands.tsRangeWithAggregations>) =>
    executor.execute(Commands.tsRangeWithAggregations(...args)),
  tsRevrangeWithAggregations: (...args: Parameters<typeof Commands.tsRevrangeWithAggregations>) =>
    executor.execute(Commands.tsRevrangeWithAggregations(...args)),
});

export const blockingTimeSeriesFamily = (executor: RedisExecutor) => ({
  tsReadBlocking: (...args: Parameters<typeof Commands.tsReadBlocking>) =>
    executor.execute(Commands.tsReadBlocking(...args)),
});
