import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/keys/index";

export const keyCommandFamily = (executor: RedisExecutor) => ({
  expire: (...args: Parameters<typeof Commands.expire>) =>
    executor.execute(Commands.expire(...args)),

  pexpire: (...args: Parameters<typeof Commands.pexpire>) =>
    executor.execute(Commands.pexpire(...args)),

  expireat: (...args: Parameters<typeof Commands.expireat>) =>
    executor.execute(Commands.expireat(...args)),

  pexpireat: (...args: Parameters<typeof Commands.pexpireat>) =>
    executor.execute(Commands.pexpireat(...args)),

  ttl: (...args: Parameters<typeof Commands.ttl>) => executor.execute(Commands.ttl(...args)),

  pttl: (...args: Parameters<typeof Commands.pttl>) => executor.execute(Commands.pttl(...args)),

  expiretime: (...args: Parameters<typeof Commands.expiretime>) =>
    executor.execute(Commands.expiretime(...args)),

  pexpiretime: (...args: Parameters<typeof Commands.pexpiretime>) =>
    executor.execute(Commands.pexpiretime(...args)),

  persist: (...args: Parameters<typeof Commands.persist>) =>
    executor.execute(Commands.persist(...args)),

  objectEncoding: (...args: Parameters<typeof Commands.objectEncoding>) =>
    executor.execute(Commands.objectEncoding(...args)),

  objectFreq: (...args: Parameters<typeof Commands.objectFreq>) =>
    executor.execute(Commands.objectFreq(...args)),

  objectIdletime: (...args: Parameters<typeof Commands.objectIdletime>) =>
    executor.execute(Commands.objectIdletime(...args)),

  objectRefcount: (...args: Parameters<typeof Commands.objectRefcount>) =>
    executor.execute(Commands.objectRefcount(...args)),

  objectHelp: (...args: Parameters<typeof Commands.objectHelp>) =>
    executor.execute(Commands.objectHelp(...args)),

  restore: (...args: Parameters<typeof Commands.restore>) =>
    executor.execute(Commands.restore(...args)),

  sort: (...args: Parameters<typeof Commands.sort>) => executor.execute(Commands.sort(...args)),

  sortRo: (...args: Parameters<typeof Commands.sortRo>) =>
    executor.execute(Commands.sortRo(...args)),

  sortStore: (...args: Parameters<typeof Commands.sortStore>) =>
    executor.execute(Commands.sortStore(...args)),

  del: (...args: Parameters<typeof Commands.del>) => executor.execute(Commands.del(...args)),

  exists: (...args: Parameters<typeof Commands.exists>) =>
    executor.execute(Commands.exists(...args)),

  touch: (...args: Parameters<typeof Commands.touch>) => executor.execute(Commands.touch(...args)),

  unlink: (...args: Parameters<typeof Commands.unlink>) =>
    executor.execute(Commands.unlink(...args)),

  type: (...args: Parameters<typeof Commands.type>) => executor.execute(Commands.type(...args)),

  dump: (...args: Parameters<typeof Commands.dump>) => executor.execute(Commands.dump(...args)),

  keys: (...args: Parameters<typeof Commands.keys>) => executor.execute(Commands.keys(...args)),

  randomkey: (...args: Parameters<typeof Commands.randomkey>) =>
    executor.execute(Commands.randomkey(...args)),

  rename: (...args: Parameters<typeof Commands.rename>) =>
    executor.execute(Commands.rename(...args)),

  renamenx: (...args: Parameters<typeof Commands.renamenx>) =>
    executor.execute(Commands.renamenx(...args)),

  copy: (...args: Parameters<typeof Commands.copy>) => executor.execute(Commands.copy(...args)),

  move: (...args: Parameters<typeof Commands.move>) => executor.execute(Commands.move(...args)),
});
