import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/bitmaps/index";

export const bitmapFamily = (executor: RedisExecutor) => ({
  bitfield: (...args: Parameters<typeof Commands.bitfield>) =>
    executor.execute(Commands.bitfield(...args)),

  bitfieldRo: (...args: Parameters<typeof Commands.bitfieldRo>) =>
    executor.execute(Commands.bitfieldRo(...args)),

  getbit: (...args: Parameters<typeof Commands.getbit>) =>
    executor.execute(Commands.getbit(...args)),

  setbit: (...args: Parameters<typeof Commands.setbit>) =>
    executor.execute(Commands.setbit(...args)),

  bitcount: (...args: Parameters<typeof Commands.bitcount>) =>
    executor.execute(Commands.bitcount(...args)),

  bitpos: (...args: Parameters<typeof Commands.bitpos>) =>
    executor.execute(Commands.bitpos(...args)),

  bitop: (...args: Parameters<typeof Commands.bitop>) => executor.execute(Commands.bitop(...args)),
});
