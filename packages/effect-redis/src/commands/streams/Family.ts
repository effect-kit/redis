import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/streams/index";
import { streamReadFamily } from "#/commands/streams/ReadFamily";

export const streamFamily = (executor: RedisExecutor) => ({
  ...streamReadFamily(executor),
  xadd: (...args: Parameters<typeof Commands.xadd>) => executor.execute(Commands.xadd(...args)),
  xaddIfExists: (...args: Parameters<typeof Commands.xaddIfExists>) =>
    executor.execute(Commands.xaddIfExists(...args)),
  xrange: (...args: Parameters<typeof Commands.xrange>) =>
    executor.execute(Commands.xrange(...args)),
  xrevrange: (...args: Parameters<typeof Commands.xrevrange>) =>
    executor.execute(Commands.xrevrange(...args)),
  xlen: (...args: Parameters<typeof Commands.xlen>) => executor.execute(Commands.xlen(...args)),
  xcfgset: (...args: Parameters<typeof Commands.xcfgset>) =>
    executor.execute(Commands.xcfgset(...args)),
  xdel: (...args: Parameters<typeof Commands.xdel>) => executor.execute(Commands.xdel(...args)),
  xack: (...args: Parameters<typeof Commands.xack>) => executor.execute(Commands.xack(...args)),
  xtrim: (...args: Parameters<typeof Commands.xtrim>) => executor.execute(Commands.xtrim(...args)),
  xackdel: (...args: Parameters<typeof Commands.xackdel>) =>
    executor.execute(Commands.xackdel(...args)),
  xdelex: (...args: Parameters<typeof Commands.xdelex>) =>
    executor.execute(Commands.xdelex(...args)),
  xnack: (...args: Parameters<typeof Commands.xnack>) => executor.execute(Commands.xnack(...args)),
  xgroupCreate: (...args: Parameters<typeof Commands.xgroupCreate>) =>
    executor.execute(Commands.xgroupCreate(...args)),
  xgroupSetid: (...args: Parameters<typeof Commands.xgroupSetid>) =>
    executor.execute(Commands.xgroupSetid(...args)),
  xgroupDestroy: (...args: Parameters<typeof Commands.xgroupDestroy>) =>
    executor.execute(Commands.xgroupDestroy(...args)),
  xgroupCreateconsumer: (...args: Parameters<typeof Commands.xgroupCreateconsumer>) =>
    executor.execute(Commands.xgroupCreateconsumer(...args)),
  xgroupDelconsumer: (...args: Parameters<typeof Commands.xgroupDelconsumer>) =>
    executor.execute(Commands.xgroupDelconsumer(...args)),
  xgroupHelp: (...args: Parameters<typeof Commands.xgroupHelp>) =>
    executor.execute(Commands.xgroupHelp(...args)),
  xpending: (...args: Parameters<typeof Commands.xpending>) =>
    executor.execute(Commands.xpending(...args)),
  xpendingEntries: (...args: Parameters<typeof Commands.xpendingEntries>) =>
    executor.execute(Commands.xpendingEntries(...args)),
  xclaim: (...args: Parameters<typeof Commands.xclaim>) =>
    executor.execute(Commands.xclaim(...args)),
  xclaimIds: (...args: Parameters<typeof Commands.xclaimIds>) =>
    executor.execute(Commands.xclaimIds(...args)),
  xautoclaim: (...args: Parameters<typeof Commands.xautoclaim>) =>
    executor.execute(Commands.xautoclaim(...args)),
  xautoclaimIds: (...args: Parameters<typeof Commands.xautoclaimIds>) =>
    executor.execute(Commands.xautoclaimIds(...args)),
  xinfoStream: (...args: Parameters<typeof Commands.xinfoStream>) =>
    executor.execute(Commands.xinfoStream(...args)),
  xinfoStreamFull: (...args: Parameters<typeof Commands.xinfoStreamFull>) =>
    executor.execute(Commands.xinfoStreamFull(...args)),
  xinfoGroups: (...args: Parameters<typeof Commands.xinfoGroups>) =>
    executor.execute(Commands.xinfoGroups(...args)),
  xinfoConsumers: (...args: Parameters<typeof Commands.xinfoConsumers>) =>
    executor.execute(Commands.xinfoConsumers(...args)),
  xinfoHelp: (...args: Parameters<typeof Commands.xinfoHelp>) =>
    executor.execute(Commands.xinfoHelp(...args)),
});
