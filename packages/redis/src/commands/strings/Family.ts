import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/strings/index";
import type { SetOptions } from "#/commands/strings/SetOptions";
import type { RedisArgument } from "#/RedisArgument";

export const stringFamily = (executor: RedisExecutor) => ({
  getBytes: (...args: Parameters<typeof Commands.getBytes>) =>
    executor.execute(Commands.getBytes(...args)),

  get: (...args: Parameters<typeof Commands.get>) => executor.execute(Commands.get(...args)),

  incr: (...args: Parameters<typeof Commands.incr>) => executor.execute(Commands.incr(...args)),

  increx: (...args: Parameters<typeof Commands.increx>) =>
    executor.execute(Commands.increx(...args)),

  increxFloat: (...args: Parameters<typeof Commands.increxFloat>) =>
    executor.execute(Commands.increxFloat(...args)),

  lcs: (...args: Parameters<typeof Commands.lcs>) => executor.execute(Commands.lcs(...args)),

  lcsLength: (...args: Parameters<typeof Commands.lcsLength>) =>
    executor.execute(Commands.lcsLength(...args)),

  lcsMatches: (...args: Parameters<typeof Commands.lcsMatches>) =>
    executor.execute(Commands.lcsMatches(...args)),

  setnx: (...args: Parameters<typeof Commands.setnx>) => executor.execute(Commands.setnx(...args)),

  setex: (...args: Parameters<typeof Commands.setex>) => executor.execute(Commands.setex(...args)),

  psetex: (...args: Parameters<typeof Commands.psetex>) =>
    executor.execute(Commands.psetex(...args)),

  mget: (...args: Parameters<typeof Commands.mget>) => executor.execute(Commands.mget(...args)),

  mset: (...args: Parameters<typeof Commands.mset>) => executor.execute(Commands.mset(...args)),

  msetnx: (...args: Parameters<typeof Commands.msetnx>) =>
    executor.execute(Commands.msetnx(...args)),

  msetex: (...args: Parameters<typeof Commands.msetex>) =>
    executor.execute(Commands.msetex(...args)),

  set: <O extends SetOptions = {}>(key: RedisArgument, value: RedisArgument, options?: O) =>
    executor.execute(Commands.set(key, value, options)),

  append: (...args: Parameters<typeof Commands.append>) =>
    executor.execute(Commands.append(...args)),

  strlen: (...args: Parameters<typeof Commands.strlen>) =>
    executor.execute(Commands.strlen(...args)),

  getdel: (...args: Parameters<typeof Commands.getdel>) =>
    executor.execute(Commands.getdel(...args)),

  getset: (...args: Parameters<typeof Commands.getset>) =>
    executor.execute(Commands.getset(...args)),

  getex: (...args: Parameters<typeof Commands.getex>) => executor.execute(Commands.getex(...args)),

  getrange: (...args: Parameters<typeof Commands.getrange>) =>
    executor.execute(Commands.getrange(...args)),

  substr: (...args: Parameters<typeof Commands.substr>) =>
    executor.execute(Commands.substr(...args)),

  setrange: (...args: Parameters<typeof Commands.setrange>) =>
    executor.execute(Commands.setrange(...args)),

  incrby: (...args: Parameters<typeof Commands.incrby>) =>
    executor.execute(Commands.incrby(...args)),

  decr: (...args: Parameters<typeof Commands.decr>) => executor.execute(Commands.decr(...args)),

  decrby: (...args: Parameters<typeof Commands.decrby>) =>
    executor.execute(Commands.decrby(...args)),

  incrbyfloat: (...args: Parameters<typeof Commands.incrbyfloat>) =>
    executor.execute(Commands.incrbyfloat(...args)),

  digest: (...args: Parameters<typeof Commands.digest>) =>
    executor.execute(Commands.digest(...args)),

  delifeq: (...args: Parameters<typeof Commands.delifeq>) =>
    executor.execute(Commands.delifeq(...args)),

  delex: (...args: Parameters<typeof Commands.delex>) => executor.execute(Commands.delex(...args)),
});
