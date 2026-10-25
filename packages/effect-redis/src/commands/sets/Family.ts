import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/sets/index";

export const setFamily = (executor: RedisExecutor) => ({
  sdiff: (...args: Parameters<typeof Commands.sdiff>) => executor.execute(Commands.sdiff(...args)),

  sinter: (...args: Parameters<typeof Commands.sinter>) =>
    executor.execute(Commands.sinter(...args)),

  sunion: (...args: Parameters<typeof Commands.sunion>) =>
    executor.execute(Commands.sunion(...args)),

  sdiffstore: (...args: Parameters<typeof Commands.sdiffstore>) =>
    executor.execute(Commands.sdiffstore(...args)),

  sinterstore: (...args: Parameters<typeof Commands.sinterstore>) =>
    executor.execute(Commands.sinterstore(...args)),

  sunionstore: (...args: Parameters<typeof Commands.sunionstore>) =>
    executor.execute(Commands.sunionstore(...args)),

  sdiffcard: (...args: Parameters<typeof Commands.sdiffcard>) =>
    executor.execute(Commands.sdiffcard(...args)),

  sintercard: (...args: Parameters<typeof Commands.sintercard>) =>
    executor.execute(Commands.sintercard(...args)),

  sunioncard: (...args: Parameters<typeof Commands.sunioncard>) =>
    executor.execute(Commands.sunioncard(...args)),

  sadd: (...args: Parameters<typeof Commands.sadd>) => executor.execute(Commands.sadd(...args)),

  srem: (...args: Parameters<typeof Commands.srem>) => executor.execute(Commands.srem(...args)),

  scard: (...args: Parameters<typeof Commands.scard>) => executor.execute(Commands.scard(...args)),

  smembers: (...args: Parameters<typeof Commands.smembers>) =>
    executor.execute(Commands.smembers(...args)),

  sismember: (...args: Parameters<typeof Commands.sismember>) =>
    executor.execute(Commands.sismember(...args)),

  smismember: (...args: Parameters<typeof Commands.smismember>) =>
    executor.execute(Commands.smismember(...args)),

  spop: (...args: Parameters<typeof Commands.spop>) => executor.execute(Commands.spop(...args)),

  spopCount: (...args: Parameters<typeof Commands.spopCount>) =>
    executor.execute(Commands.spopCount(...args)),

  srandmember: (...args: Parameters<typeof Commands.srandmember>) =>
    executor.execute(Commands.srandmember(...args)),

  srandmemberCount: (...args: Parameters<typeof Commands.srandmemberCount>) =>
    executor.execute(Commands.srandmemberCount(...args)),

  smove: (...args: Parameters<typeof Commands.smove>) => executor.execute(Commands.smove(...args)),
});
