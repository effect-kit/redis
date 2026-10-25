import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/sorted-sets/index";

export const sortedSetFamily = (executor: RedisExecutor) => ({
  zinter: (...args: Parameters<typeof Commands.zinter>) =>
    executor.execute(Commands.zinter(...args)),

  zinterWithScores: (...args: Parameters<typeof Commands.zinterWithScores>) =>
    executor.execute(Commands.zinterWithScores(...args)),

  zunion: (...args: Parameters<typeof Commands.zunion>) =>
    executor.execute(Commands.zunion(...args)),

  zunionWithScores: (...args: Parameters<typeof Commands.zunionWithScores>) =>
    executor.execute(Commands.zunionWithScores(...args)),

  zinterstore: (...args: Parameters<typeof Commands.zinterstore>) =>
    executor.execute(Commands.zinterstore(...args)),

  zunionstore: (...args: Parameters<typeof Commands.zunionstore>) =>
    executor.execute(Commands.zunionstore(...args)),

  zdiff: (...args: Parameters<typeof Commands.zdiff>) => executor.execute(Commands.zdiff(...args)),

  zdiffWithScores: (...args: Parameters<typeof Commands.zdiffWithScores>) =>
    executor.execute(Commands.zdiffWithScores(...args)),

  zdiffstore: (...args: Parameters<typeof Commands.zdiffstore>) =>
    executor.execute(Commands.zdiffstore(...args)),

  zintercard: (...args: Parameters<typeof Commands.zintercard>) =>
    executor.execute(Commands.zintercard(...args)),

  zmpop: (...args: Parameters<typeof Commands.zmpop>) => executor.execute(Commands.zmpop(...args)),

  zrevrange: (...args: Parameters<typeof Commands.zrevrange>) =>
    executor.execute(Commands.zrevrange(...args)),

  zrevrangeWithScores: (...args: Parameters<typeof Commands.zrevrangeWithScores>) =>
    executor.execute(Commands.zrevrangeWithScores(...args)),

  zrangebyscore: (...args: Parameters<typeof Commands.zrangebyscore>) =>
    executor.execute(Commands.zrangebyscore(...args)),

  zrangebyscoreWithScores: (...args: Parameters<typeof Commands.zrangebyscoreWithScores>) =>
    executor.execute(Commands.zrangebyscoreWithScores(...args)),

  zrevrangebyscore: (...args: Parameters<typeof Commands.zrevrangebyscore>) =>
    executor.execute(Commands.zrevrangebyscore(...args)),

  zrevrangebyscoreWithScores: (...args: Parameters<typeof Commands.zrevrangebyscoreWithScores>) =>
    executor.execute(Commands.zrevrangebyscoreWithScores(...args)),

  zrangebylex: (...args: Parameters<typeof Commands.zrangebylex>) =>
    executor.execute(Commands.zrangebylex(...args)),

  zrevrangebylex: (...args: Parameters<typeof Commands.zrevrangebylex>) =>
    executor.execute(Commands.zrevrangebylex(...args)),

  zrange: (...args: Parameters<typeof Commands.zrange>) =>
    executor.execute(Commands.zrange(...args)),

  zrangeWithScores: (...args: Parameters<typeof Commands.zrangeWithScores>) =>
    executor.execute(Commands.zrangeWithScores(...args)),

  zrangestore: (...args: Parameters<typeof Commands.zrangestore>) =>
    executor.execute(Commands.zrangestore(...args)),

  zcount: (...args: Parameters<typeof Commands.zcount>) =>
    executor.execute(Commands.zcount(...args)),

  zlexcount: (...args: Parameters<typeof Commands.zlexcount>) =>
    executor.execute(Commands.zlexcount(...args)),

  zremrangebyrank: (...args: Parameters<typeof Commands.zremrangebyrank>) =>
    executor.execute(Commands.zremrangebyrank(...args)),

  zremrangebyscore: (...args: Parameters<typeof Commands.zremrangebyscore>) =>
    executor.execute(Commands.zremrangebyscore(...args)),

  zremrangebylex: (...args: Parameters<typeof Commands.zremrangebylex>) =>
    executor.execute(Commands.zremrangebylex(...args)),

  zadd: (...args: Parameters<typeof Commands.zadd>) => executor.execute(Commands.zadd(...args)),

  zaddIncrement: (...args: Parameters<typeof Commands.zaddIncrement>) =>
    executor.execute(Commands.zaddIncrement(...args)),

  zcard: (...args: Parameters<typeof Commands.zcard>) => executor.execute(Commands.zcard(...args)),

  zincrby: (...args: Parameters<typeof Commands.zincrby>) =>
    executor.execute(Commands.zincrby(...args)),

  zrem: (...args: Parameters<typeof Commands.zrem>) => executor.execute(Commands.zrem(...args)),

  zmscore: (...args: Parameters<typeof Commands.zmscore>) =>
    executor.execute(Commands.zmscore(...args)),

  zrank: (...args: Parameters<typeof Commands.zrank>) => executor.execute(Commands.zrank(...args)),

  zrevrank: (...args: Parameters<typeof Commands.zrevrank>) =>
    executor.execute(Commands.zrevrank(...args)),

  zrankWithScore: (...args: Parameters<typeof Commands.zrankWithScore>) =>
    executor.execute(Commands.zrankWithScore(...args)),

  zrevrankWithScore: (...args: Parameters<typeof Commands.zrevrankWithScore>) =>
    executor.execute(Commands.zrevrankWithScore(...args)),

  zpopmin: (...args: Parameters<typeof Commands.zpopmin>) =>
    executor.execute(Commands.zpopmin(...args)),

  zpopmax: (...args: Parameters<typeof Commands.zpopmax>) =>
    executor.execute(Commands.zpopmax(...args)),

  zrandmember: (...args: Parameters<typeof Commands.zrandmember>) =>
    executor.execute(Commands.zrandmember(...args)),

  zrandmemberCount: (...args: Parameters<typeof Commands.zrandmemberCount>) =>
    executor.execute(Commands.zrandmemberCount(...args)),

  zrandmemberWithScores: (...args: Parameters<typeof Commands.zrandmemberWithScores>) =>
    executor.execute(Commands.zrandmemberWithScores(...args)),

  zscore: (...args: Parameters<typeof Commands.zscore>) =>
    executor.execute(Commands.zscore(...args)),

  zscoreToken: (...args: Parameters<typeof Commands.zscoreToken>) =>
    executor.execute(Commands.zscoreToken(...args)),
});
