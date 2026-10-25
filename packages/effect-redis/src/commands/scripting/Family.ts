import type { ReplyDecoder } from "#/command/Command";
import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/scripting/index";
import type { ScriptArguments } from "#/commands/scripting/Invocation";
import type { RedisArgument } from "#/RedisArgument";

export const scriptingFamily = (executor: RedisExecutor) => ({
  evalScript: <A, E, R>(
    source: RedisArgument,
    input: ScriptArguments,
    decode: ReplyDecoder<A, E, R>,
  ) => executor.execute(Commands.evalScript(source, input, decode)),
  evalSha: <A, E, R>(source: string, input: ScriptArguments, decode: ReplyDecoder<A, E, R>) =>
    executor.execute(Commands.evalSha(source, input, decode)),
  evalReadOnly: <A, E, R>(
    source: RedisArgument,
    input: ScriptArguments,
    decode: ReplyDecoder<A, E, R>,
  ) => executor.execute(Commands.evalReadOnly(source, input, decode)),
  evalShaReadOnly: <A, E, R>(
    source: string,
    input: ScriptArguments,
    decode: ReplyDecoder<A, E, R>,
  ) => executor.execute(Commands.evalShaReadOnly(source, input, decode)),
  fcall: <A, E, R>(source: RedisArgument, input: ScriptArguments, decode: ReplyDecoder<A, E, R>) =>
    executor.execute(Commands.fcall(source, input, decode)),
  fcallReadOnly: <A, E, R>(
    source: RedisArgument,
    input: ScriptArguments,
    decode: ReplyDecoder<A, E, R>,
  ) => executor.execute(Commands.fcallReadOnly(source, input, decode)),
  scriptLoad: (...args: Parameters<typeof Commands.scriptLoad>) =>
    executor.execute(Commands.scriptLoad(...args)),
  scriptExists: (...args: Parameters<typeof Commands.scriptExists>) =>
    executor.execute(Commands.scriptExists(...args)),
  scriptFlush: (...args: Parameters<typeof Commands.scriptFlush>) =>
    executor.execute(Commands.scriptFlush(...args)),
  scriptShow: (...args: Parameters<typeof Commands.scriptShow>) =>
    executor.execute(Commands.scriptShow(...args)),
  scriptKill: (...args: Parameters<typeof Commands.scriptKill>) =>
    executor.execute(Commands.scriptKill(...args)),
  scriptHelp: (...args: Parameters<typeof Commands.scriptHelp>) =>
    executor.execute(Commands.scriptHelp(...args)),
  functionList: (...args: Parameters<typeof Commands.functionList>) =>
    executor.execute(Commands.functionList(...args)),
  functionLoad: (...args: Parameters<typeof Commands.functionLoad>) =>
    executor.execute(Commands.functionLoad(...args)),
  functionDelete: (...args: Parameters<typeof Commands.functionDelete>) =>
    executor.execute(Commands.functionDelete(...args)),
  functionDump: (...args: Parameters<typeof Commands.functionDump>) =>
    executor.execute(Commands.functionDump(...args)),
  functionRestore: (...args: Parameters<typeof Commands.functionRestore>) =>
    executor.execute(Commands.functionRestore(...args)),
  functionFlush: (...args: Parameters<typeof Commands.functionFlush>) =>
    executor.execute(Commands.functionFlush(...args)),
  functionKill: (...args: Parameters<typeof Commands.functionKill>) =>
    executor.execute(Commands.functionKill(...args)),
  functionHelp: (...args: Parameters<typeof Commands.functionHelp>) =>
    executor.execute(Commands.functionHelp(...args)),
  functionStats: (...args: Parameters<typeof Commands.functionStats>) =>
    executor.execute(Commands.functionStats(...args)),
});
