import type { RedisExecutor } from "#/command/Executor";
import * as Lists from "#/commands/lists/Blocking";
import * as SortedSets from "#/commands/sorted-sets/Blocking";

export const blockingFamily = (executor: RedisExecutor) => ({
  blpop: (...args: Parameters<typeof Lists.blpop>) => executor.execute(Lists.blpop(...args)),
  brpop: (...args: Parameters<typeof Lists.brpop>) => executor.execute(Lists.brpop(...args)),
  brpoplpush: (...args: Parameters<typeof Lists.brpoplpush>) =>
    executor.execute(Lists.brpoplpush(...args)),
  blmove: (...args: Parameters<typeof Lists.blmove>) => executor.execute(Lists.blmove(...args)),
  blmpop: (...args: Parameters<typeof Lists.blmpop>) => executor.execute(Lists.blmpop(...args)),
  blmovem: (...args: Parameters<typeof Lists.blmovem>) => executor.execute(Lists.blmovem(...args)),
  bzpopmin: (...args: Parameters<typeof SortedSets.bzpopmin>) =>
    executor.execute(SortedSets.bzpopmin(...args)),
  bzpopmax: (...args: Parameters<typeof SortedSets.bzpopmax>) =>
    executor.execute(SortedSets.bzpopmax(...args)),
  bzmpop: (...args: Parameters<typeof SortedSets.bzmpop>) =>
    executor.execute(SortedSets.bzmpop(...args)),
});
