import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/vectors/index";

export const vectorFamily = (executor: RedisExecutor) => ({
  vadd: (...args: Parameters<typeof Commands.vadd>) => executor.execute(Commands.vadd(...args)),

  vrem: (...args: Parameters<typeof Commands.vrem>) => executor.execute(Commands.vrem(...args)),

  vismember: (...args: Parameters<typeof Commands.vismember>) =>
    executor.execute(Commands.vismember(...args)),

  vdim: (...args: Parameters<typeof Commands.vdim>) => executor.execute(Commands.vdim(...args)),

  vcard: (...args: Parameters<typeof Commands.vcard>) => executor.execute(Commands.vcard(...args)),

  vinfo: (...args: Parameters<typeof Commands.vinfo>) => executor.execute(Commands.vinfo(...args)),

  vemb: (...args: Parameters<typeof Commands.vemb>) => executor.execute(Commands.vemb(...args)),

  vembRaw: (...args: Parameters<typeof Commands.vembRaw>) =>
    executor.execute(Commands.vembRaw(...args)),

  vlinks: (...args: Parameters<typeof Commands.vlinks>) =>
    executor.execute(Commands.vlinks(...args)),

  vlinksWithScores: (...args: Parameters<typeof Commands.vlinksWithScores>) =>
    executor.execute(Commands.vlinksWithScores(...args)),

  vgetattr: (...args: Parameters<typeof Commands.vgetattr>) =>
    executor.execute(Commands.vgetattr(...args)),

  vsetattr: (...args: Parameters<typeof Commands.vsetattr>) =>
    executor.execute(Commands.vsetattr(...args)),

  vrandmember: (...args: Parameters<typeof Commands.vrandmember>) =>
    executor.execute(Commands.vrandmember(...args)),

  vrandmemberCount: (...args: Parameters<typeof Commands.vrandmemberCount>) =>
    executor.execute(Commands.vrandmemberCount(...args)),

  vrange: (...args: Parameters<typeof Commands.vrange>) =>
    executor.execute(Commands.vrange(...args)),

  vsim: (...args: Parameters<typeof Commands.vsim>) => executor.execute(Commands.vsim(...args)),

  vsimWithScores: (...args: Parameters<typeof Commands.vsimWithScores>) =>
    executor.execute(Commands.vsimWithScores(...args)),

  vsimWithAttributes: (...args: Parameters<typeof Commands.vsimWithAttributes>) =>
    executor.execute(Commands.vsimWithAttributes(...args)),

  vsimWithScoresAndAttributes: (...args: Parameters<typeof Commands.vsimWithScoresAndAttributes>) =>
    executor.execute(Commands.vsimWithScoresAndAttributes(...args)),
});
