import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/pubsub/index";

export const pubsubFamily = (executor: RedisExecutor) => ({
  publish: (...args: Parameters<typeof Commands.publish>) =>
    executor.execute(Commands.publish(...args)),
  spublish: (...args: Parameters<typeof Commands.spublish>) =>
    executor.execute(Commands.spublish(...args)),
  pubsubChannels: (...args: Parameters<typeof Commands.pubsubChannels>) =>
    executor.execute(Commands.pubsubChannels(...args)),
  pubsubShardChannels: (...args: Parameters<typeof Commands.pubsubShardChannels>) =>
    executor.execute(Commands.pubsubShardChannels(...args)),
  pubsubNumSub: (...args: Parameters<typeof Commands.pubsubNumSub>) =>
    executor.execute(Commands.pubsubNumSub(...args)),
  pubsubShardNumSub: (...args: Parameters<typeof Commands.pubsubShardNumSub>) =>
    executor.execute(Commands.pubsubShardNumSub(...args)),
  pubsubNumPat: () => executor.execute(Commands.pubsubNumPat()),
  pubsubHelp: () => executor.execute(Commands.pubsubHelp()),
});
