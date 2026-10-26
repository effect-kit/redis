import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/hashes/index";

export const hashFamily = (executor: RedisExecutor) => ({
  hexpire: (...args: Parameters<typeof Commands.hexpire>) =>
    executor.execute(Commands.hexpire(...args)),

  hpexpire: (...args: Parameters<typeof Commands.hpexpire>) =>
    executor.execute(Commands.hpexpire(...args)),

  hexpireat: (...args: Parameters<typeof Commands.hexpireat>) =>
    executor.execute(Commands.hexpireat(...args)),

  hpexpireat: (...args: Parameters<typeof Commands.hpexpireat>) =>
    executor.execute(Commands.hpexpireat(...args)),

  httl: (...args: Parameters<typeof Commands.httl>) => executor.execute(Commands.httl(...args)),

  hpttl: (...args: Parameters<typeof Commands.hpttl>) => executor.execute(Commands.hpttl(...args)),

  hexpiretime: (...args: Parameters<typeof Commands.hexpiretime>) =>
    executor.execute(Commands.hexpiretime(...args)),

  hpexpiretime: (...args: Parameters<typeof Commands.hpexpiretime>) =>
    executor.execute(Commands.hpexpiretime(...args)),

  hpersist: (...args: Parameters<typeof Commands.hpersist>) =>
    executor.execute(Commands.hpersist(...args)),

  hgetdel: (...args: Parameters<typeof Commands.hgetdel>) =>
    executor.execute(Commands.hgetdel(...args)),

  hgetex: (...args: Parameters<typeof Commands.hgetex>) =>
    executor.execute(Commands.hgetex(...args)),

  hsetex: (...args: Parameters<typeof Commands.hsetex>) =>
    executor.execute(Commands.hsetex(...args)),

  hget: (...args: Parameters<typeof Commands.hget>) => executor.execute(Commands.hget(...args)),

  hgetText: (...args: Parameters<typeof Commands.hgetText>) =>
    executor.execute(Commands.hgetText(...args)),

  hgetall: (...args: Parameters<typeof Commands.hgetall>) =>
    executor.execute(Commands.hgetall(...args)),

  hkeys: (...args: Parameters<typeof Commands.hkeys>) => executor.execute(Commands.hkeys(...args)),

  hvals: (...args: Parameters<typeof Commands.hvals>) => executor.execute(Commands.hvals(...args)),

  hlen: (...args: Parameters<typeof Commands.hlen>) => executor.execute(Commands.hlen(...args)),

  hstrlen: (...args: Parameters<typeof Commands.hstrlen>) =>
    executor.execute(Commands.hstrlen(...args)),

  hexists: (...args: Parameters<typeof Commands.hexists>) =>
    executor.execute(Commands.hexists(...args)),

  hset: (...args: Parameters<typeof Commands.hset>) => executor.execute(Commands.hset(...args)),

  hmset: (...args: Parameters<typeof Commands.hmset>) => executor.execute(Commands.hmset(...args)),

  hsetnx: (...args: Parameters<typeof Commands.hsetnx>) =>
    executor.execute(Commands.hsetnx(...args)),

  hdel: (...args: Parameters<typeof Commands.hdel>) => executor.execute(Commands.hdel(...args)),

  hmget: (...args: Parameters<typeof Commands.hmget>) => executor.execute(Commands.hmget(...args)),

  hincrby: (...args: Parameters<typeof Commands.hincrby>) =>
    executor.execute(Commands.hincrby(...args)),

  hincrbyfloat: (...args: Parameters<typeof Commands.hincrbyfloat>) =>
    executor.execute(Commands.hincrbyfloat(...args)),

  hrandfield: (...args: Parameters<typeof Commands.hrandfield>) =>
    executor.execute(Commands.hrandfield(...args)),

  hrandfieldCount: (...args: Parameters<typeof Commands.hrandfieldCount>) =>
    executor.execute(Commands.hrandfieldCount(...args)),

  hrandfieldWithValues: (...args: Parameters<typeof Commands.hrandfieldWithValues>) =>
    executor.execute(Commands.hrandfieldWithValues(...args)),
});
