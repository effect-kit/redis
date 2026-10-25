import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/arrays/index";

export const arrayFamily = (executor: RedisExecutor) => ({
  arop: (...args: Parameters<typeof Commands.arop>) => executor.execute(Commands.arop(...args)),

  aropInteger: (...args: Parameters<typeof Commands.aropInteger>) =>
    executor.execute(Commands.aropInteger(...args)),

  aropMatch: (...args: Parameters<typeof Commands.aropMatch>) =>
    executor.execute(Commands.aropMatch(...args)),

  argrep: (...args: Parameters<typeof Commands.argrep>) =>
    executor.execute(Commands.argrep(...args)),

  argrepWithValues: (...args: Parameters<typeof Commands.argrepWithValues>) =>
    executor.execute(Commands.argrepWithValues(...args)),

  arinfo: (...args: Parameters<typeof Commands.arinfo>) =>
    executor.execute(Commands.arinfo(...args)),

  arcount: (...args: Parameters<typeof Commands.arcount>) =>
    executor.execute(Commands.arcount(...args)),

  arlen: (...args: Parameters<typeof Commands.arlen>) => executor.execute(Commands.arlen(...args)),

  arget: (...args: Parameters<typeof Commands.arget>) => executor.execute(Commands.arget(...args)),

  argetrange: (...args: Parameters<typeof Commands.argetrange>) =>
    executor.execute(Commands.argetrange(...args)),

  armget: (...args: Parameters<typeof Commands.armget>) =>
    executor.execute(Commands.armget(...args)),

  arset: (...args: Parameters<typeof Commands.arset>) => executor.execute(Commands.arset(...args)),

  armset: (...args: Parameters<typeof Commands.armset>) =>
    executor.execute(Commands.armset(...args)),

  ardel: (...args: Parameters<typeof Commands.ardel>) => executor.execute(Commands.ardel(...args)),

  ardelrange: (...args: Parameters<typeof Commands.ardelrange>) =>
    executor.execute(Commands.ardelrange(...args)),

  arinsert: (...args: Parameters<typeof Commands.arinsert>) =>
    executor.execute(Commands.arinsert(...args)),

  arnext: (...args: Parameters<typeof Commands.arnext>) =>
    executor.execute(Commands.arnext(...args)),

  arseek: (...args: Parameters<typeof Commands.arseek>) =>
    executor.execute(Commands.arseek(...args)),

  arring: (...args: Parameters<typeof Commands.arring>) =>
    executor.execute(Commands.arring(...args)),

  arlastitems: (...args: Parameters<typeof Commands.arlastitems>) =>
    executor.execute(Commands.arlastitems(...args)),
});
