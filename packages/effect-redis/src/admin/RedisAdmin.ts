import { Context, Effect, Layer } from "effect";

import type { Command } from "#/command/Command";
import * as Commands from "#/commands/admin/index";
import { RedisSessions } from "#/sessions/RedisSessions";
import type { RedisSessionsClient } from "#/sessions/RedisSessions";

export const makeRedisAdmin = (sessions: RedisSessionsClient) => {
  const execute = <A, E, RD, RE>(command: Command<A, E, RD, RE>) =>
    sessions.withSession((session) => session.execute(command));

  return {
    execute,
    aclCat: (...args: Parameters<typeof Commands.aclCat>) => execute(Commands.aclCat(...args)),
    aclDelUser: (...args: Parameters<typeof Commands.aclDelUser>) =>
      execute(Commands.aclDelUser(...args)),
    aclSetUser: (...args: Parameters<typeof Commands.aclSetUser>) =>
      execute(Commands.aclSetUser(...args)),
    aclGetUser: (...args: Parameters<typeof Commands.aclGetUser>) =>
      execute(Commands.aclGetUser(...args)),
    aclList: (...args: Parameters<typeof Commands.aclList>) => execute(Commands.aclList(...args)),
    aclUsers: (...args: Parameters<typeof Commands.aclUsers>) =>
      execute(Commands.aclUsers(...args)),
    aclWhoAmI: (...args: Parameters<typeof Commands.aclWhoAmI>) =>
      execute(Commands.aclWhoAmI(...args)),
    aclDigest: (...args: Parameters<typeof Commands.aclDigest>) =>
      execute(Commands.aclDigest(...args)),
    aclHelp: (...args: Parameters<typeof Commands.aclHelp>) => execute(Commands.aclHelp(...args)),
    aclLoad: (...args: Parameters<typeof Commands.aclLoad>) => execute(Commands.aclLoad(...args)),
    aclSave: (...args: Parameters<typeof Commands.aclSave>) => execute(Commands.aclSave(...args)),
    aclGenPass: (...args: Parameters<typeof Commands.aclGenPass>) =>
      execute(Commands.aclGenPass(...args)),
    aclDryRun: (...args: Parameters<typeof Commands.aclDryRun>) =>
      execute(Commands.aclDryRun(...args)),
    aclLog: (...args: Parameters<typeof Commands.aclLog>) => execute(Commands.aclLog(...args)),
    aclLogReset: (...args: Parameters<typeof Commands.aclLogReset>) =>
      execute(Commands.aclLogReset(...args)),
    configGet: (...args: Parameters<typeof Commands.configGet>) =>
      execute(Commands.configGet(...args)),
    configSet: (...args: Parameters<typeof Commands.configSet>) =>
      execute(Commands.configSet(...args)),
    configHelp: (...args: Parameters<typeof Commands.configHelp>) =>
      execute(Commands.configHelp(...args)),
    configResetStat: (...args: Parameters<typeof Commands.configResetStat>) =>
      execute(Commands.configResetStat(...args)),
    configRewrite: (...args: Parameters<typeof Commands.configRewrite>) =>
      execute(Commands.configRewrite(...args)),
    info: (...args: Parameters<typeof Commands.info>) => execute(Commands.info(...args)),
    memoryDoctor: (...args: Parameters<typeof Commands.memoryDoctor>) =>
      execute(Commands.memoryDoctor(...args)),
    memoryHelp: (...args: Parameters<typeof Commands.memoryHelp>) =>
      execute(Commands.memoryHelp(...args)),
    memoryMallocStats: (...args: Parameters<typeof Commands.memoryMallocStats>) =>
      execute(Commands.memoryMallocStats(...args)),
    memoryPurge: (...args: Parameters<typeof Commands.memoryPurge>) =>
      execute(Commands.memoryPurge(...args)),
    memoryStats: (...args: Parameters<typeof Commands.memoryStats>) =>
      execute(Commands.memoryStats(...args)),
    memoryUsage: (...args: Parameters<typeof Commands.memoryUsage>) =>
      execute(Commands.memoryUsage(...args)),
    moduleList: (...args: Parameters<typeof Commands.moduleList>) =>
      execute(Commands.moduleList(...args)),
    moduleHelp: (...args: Parameters<typeof Commands.moduleHelp>) =>
      execute(Commands.moduleHelp(...args)),
    moduleLoad: (...args: Parameters<typeof Commands.moduleLoad>) =>
      execute(Commands.moduleLoad(...args)),
    moduleLoadEx: (...args: Parameters<typeof Commands.moduleLoadEx>) =>
      execute(Commands.moduleLoadEx(...args)),
    moduleUnload: (...args: Parameters<typeof Commands.moduleUnload>) =>
      execute(Commands.moduleUnload(...args)),
    command: (...args: Parameters<typeof Commands.command>) => execute(Commands.command(...args)),
    commandCount: (...args: Parameters<typeof Commands.commandCount>) =>
      execute(Commands.commandCount(...args)),
    commandHelp: (...args: Parameters<typeof Commands.commandHelp>) =>
      execute(Commands.commandHelp(...args)),
    commandInfo: (...args: Parameters<typeof Commands.commandInfo>) =>
      execute(Commands.commandInfo(...args)),
    commandDocs: (...args: Parameters<typeof Commands.commandDocs>) =>
      execute(Commands.commandDocs(...args)),
    commandGetKeys: (...args: Parameters<typeof Commands.commandGetKeys>) =>
      execute(Commands.commandGetKeys(...args)),
    commandGetKeysAndFlags: (...args: Parameters<typeof Commands.commandGetKeysAndFlags>) =>
      execute(Commands.commandGetKeysAndFlags(...args)),
    commandList: (...args: Parameters<typeof Commands.commandList>) =>
      execute(Commands.commandList(...args)),
    dbsize: (...args: Parameters<typeof Commands.dbsize>) => execute(Commands.dbsize(...args)),
    lastSave: (...args: Parameters<typeof Commands.lastSave>) =>
      execute(Commands.lastSave(...args)),
    time: (...args: Parameters<typeof Commands.time>) => execute(Commands.time(...args)),
    role: (...args: Parameters<typeof Commands.role>) => execute(Commands.role(...args)),
    save: (...args: Parameters<typeof Commands.save>) => execute(Commands.save(...args)),
    bgrewriteaof: (...args: Parameters<typeof Commands.bgrewriteaof>) =>
      execute(Commands.bgrewriteaof(...args)),
    bgsave: (...args: Parameters<typeof Commands.bgsave>) => execute(Commands.bgsave(...args)),
    flushDb: (...args: Parameters<typeof Commands.flushDb>) => execute(Commands.flushDb(...args)),
    flushAll: (...args: Parameters<typeof Commands.flushAll>) =>
      execute(Commands.flushAll(...args)),
    swapDb: (...args: Parameters<typeof Commands.swapDb>) => execute(Commands.swapDb(...args)),
    replicaOf: (...args: Parameters<typeof Commands.replicaOf>) =>
      execute(Commands.replicaOf(...args)),
    slaveOf: (...args: Parameters<typeof Commands.slaveOf>) => execute(Commands.slaveOf(...args)),
    failover: (...args: Parameters<typeof Commands.failover>) =>
      execute(Commands.failover(...args)),
    lolwut: (...args: Parameters<typeof Commands.lolwut>) => execute(Commands.lolwut(...args)),
    slowlogGet: (...args: Parameters<typeof Commands.slowlogGet>) =>
      execute(Commands.slowlogGet(...args)),
    slowlogLen: (...args: Parameters<typeof Commands.slowlogLen>) =>
      execute(Commands.slowlogLen(...args)),
    slowlogReset: (...args: Parameters<typeof Commands.slowlogReset>) =>
      execute(Commands.slowlogReset(...args)),
    slowlogHelp: (...args: Parameters<typeof Commands.slowlogHelp>) =>
      execute(Commands.slowlogHelp(...args)),
    commandlogGet: (...args: Parameters<typeof Commands.commandlogGet>) =>
      execute(Commands.commandlogGet(...args)),
    commandlogLen: (...args: Parameters<typeof Commands.commandlogLen>) =>
      execute(Commands.commandlogLen(...args)),
    commandlogReset: (...args: Parameters<typeof Commands.commandlogReset>) =>
      execute(Commands.commandlogReset(...args)),
    commandlogHelp: (...args: Parameters<typeof Commands.commandlogHelp>) =>
      execute(Commands.commandlogHelp(...args)),
    latencyDoctor: (...args: Parameters<typeof Commands.latencyDoctor>) =>
      execute(Commands.latencyDoctor(...args)),
    latencyHelp: (...args: Parameters<typeof Commands.latencyHelp>) =>
      execute(Commands.latencyHelp(...args)),
    latencyGraph: (...args: Parameters<typeof Commands.latencyGraph>) =>
      execute(Commands.latencyGraph(...args)),
    latencyHistory: (...args: Parameters<typeof Commands.latencyHistory>) =>
      execute(Commands.latencyHistory(...args)),
    latencyLatest: (...args: Parameters<typeof Commands.latencyLatest>) =>
      execute(Commands.latencyLatest(...args)),
    latencyReset: (...args: Parameters<typeof Commands.latencyReset>) =>
      execute(Commands.latencyReset(...args)),
    latencyHistogram: (...args: Parameters<typeof Commands.latencyHistogram>) =>
      execute(Commands.latencyHistogram(...args)),
    hotkeysStart: (...args: Parameters<typeof Commands.hotkeysStart>) =>
      execute(Commands.hotkeysStart(...args)),
    hotkeysGet: (...args: Parameters<typeof Commands.hotkeysGet>) =>
      execute(Commands.hotkeysGet(...args)),
    hotkeysStop: (...args: Parameters<typeof Commands.hotkeysStop>) =>
      execute(Commands.hotkeysStop(...args)),
    hotkeysReset: (...args: Parameters<typeof Commands.hotkeysReset>) =>
      execute(Commands.hotkeysReset(...args)),
    hotkeysHelp: (...args: Parameters<typeof Commands.hotkeysHelp>) =>
      execute(Commands.hotkeysHelp(...args)),
    clientId: (...args: Parameters<typeof Commands.clientId>) =>
      execute(Commands.clientId(...args)),
    clientGetName: (...args: Parameters<typeof Commands.clientGetName>) =>
      execute(Commands.clientGetName(...args)),
    clientGetRedir: (...args: Parameters<typeof Commands.clientGetRedir>) =>
      execute(Commands.clientGetRedir(...args)),
    clientInfo: (...args: Parameters<typeof Commands.clientInfo>) =>
      execute(Commands.clientInfo(...args)),
    clientHelp: (...args: Parameters<typeof Commands.clientHelp>) =>
      execute(Commands.clientHelp(...args)),
    echo: (...args: Parameters<typeof Commands.echo>) => execute(Commands.echo(...args)),
    clientList: (...args: Parameters<typeof Commands.clientList>) =>
      execute(Commands.clientList(...args)),
    clientSetName: (...args: Parameters<typeof Commands.clientSetName>) =>
      execute(Commands.clientSetName(...args)),
    clientSetInfo: (...args: Parameters<typeof Commands.clientSetInfo>) =>
      execute(Commands.clientSetInfo(...args)),
    clientNoEvict: (...args: Parameters<typeof Commands.clientNoEvict>) =>
      execute(Commands.clientNoEvict(...args)),
    clientNoTouch: (...args: Parameters<typeof Commands.clientNoTouch>) =>
      execute(Commands.clientNoTouch(...args)),
    clientPause: (...args: Parameters<typeof Commands.clientPause>) =>
      execute(Commands.clientPause(...args)),
    clientUnpause: (...args: Parameters<typeof Commands.clientUnpause>) =>
      execute(Commands.clientUnpause(...args)),
    clientUnblock: (...args: Parameters<typeof Commands.clientUnblock>) =>
      execute(Commands.clientUnblock(...args)),
    clientKill: (...args: Parameters<typeof Commands.clientKill>) =>
      execute(Commands.clientKill(...args)),
    clientKillAddress: (...args: Parameters<typeof Commands.clientKillAddress>) =>
      execute(Commands.clientKillAddress(...args)),
    migrate: (...args: Parameters<typeof Commands.migrate>) => execute(Commands.migrate(...args)),
    flushSlots: (...args: Parameters<typeof Commands.flushSlots>) =>
      execute(Commands.flushSlots(...args)),
  };
};

export type RedisAdminClient = ReturnType<typeof makeRedisAdmin>;

/** Bind administration to an explicitly configured backend. No automatic node broadcast. */
export class RedisAdmin extends Context.Service<RedisAdmin, RedisAdminClient>()(
  "@envoy1084/effect-redis/RedisAdmin",
) {
  static readonly layer = Layer.effect(RedisAdmin, RedisSessions.pipe(Effect.map(makeRedisAdmin)));
}
