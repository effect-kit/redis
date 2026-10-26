import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/lists/index";

export const listFamily = (executor: RedisExecutor) => ({
  lmove: (...args: Parameters<typeof Commands.lmove>) => executor.execute(Commands.lmove(...args)),

  rpoplpush: (...args: Parameters<typeof Commands.rpoplpush>) =>
    executor.execute(Commands.rpoplpush(...args)),

  lmovem: (...args: Parameters<typeof Commands.lmovem>) =>
    executor.execute(Commands.lmovem(...args)),

  lmpop: (...args: Parameters<typeof Commands.lmpop>) => executor.execute(Commands.lmpop(...args)),

  lpush: (...args: Parameters<typeof Commands.lpush>) => executor.execute(Commands.lpush(...args)),

  rpush: (...args: Parameters<typeof Commands.rpush>) => executor.execute(Commands.rpush(...args)),

  lpushx: (...args: Parameters<typeof Commands.lpushx>) =>
    executor.execute(Commands.lpushx(...args)),

  rpushx: (...args: Parameters<typeof Commands.rpushx>) =>
    executor.execute(Commands.rpushx(...args)),

  llen: (...args: Parameters<typeof Commands.llen>) => executor.execute(Commands.llen(...args)),

  lindex: (...args: Parameters<typeof Commands.lindex>) =>
    executor.execute(Commands.lindex(...args)),

  lrange: (...args: Parameters<typeof Commands.lrange>) =>
    executor.execute(Commands.lrange(...args)),

  ltrim: (...args: Parameters<typeof Commands.ltrim>) => executor.execute(Commands.ltrim(...args)),

  lset: (...args: Parameters<typeof Commands.lset>) => executor.execute(Commands.lset(...args)),

  lrem: (...args: Parameters<typeof Commands.lrem>) => executor.execute(Commands.lrem(...args)),

  linsert: (...args: Parameters<typeof Commands.linsert>) =>
    executor.execute(Commands.linsert(...args)),

  lpop: (...args: Parameters<typeof Commands.lpop>) => executor.execute(Commands.lpop(...args)),

  rpop: (...args: Parameters<typeof Commands.rpop>) => executor.execute(Commands.rpop(...args)),

  lpopCount: (...args: Parameters<typeof Commands.lpopCount>) =>
    executor.execute(Commands.lpopCount(...args)),

  rpopCount: (...args: Parameters<typeof Commands.rpopCount>) =>
    executor.execute(Commands.rpopCount(...args)),

  lpos: (...args: Parameters<typeof Commands.lpos>) => executor.execute(Commands.lpos(...args)),

  lposCount: (...args: Parameters<typeof Commands.lposCount>) =>
    executor.execute(Commands.lposCount(...args)),
});
