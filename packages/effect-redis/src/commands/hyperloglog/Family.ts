import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/hyperloglog/index";

export const hyperloglogFamily = (executor: RedisExecutor) => ({
  pfadd: (...args: Parameters<typeof Commands.pfadd>) => executor.execute(Commands.pfadd(...args)),

  pfcount: (...args: Parameters<typeof Commands.pfcount>) =>
    executor.execute(Commands.pfcount(...args)),

  pfmerge: (...args: Parameters<typeof Commands.pfmerge>) =>
    executor.execute(Commands.pfmerge(...args)),
});
