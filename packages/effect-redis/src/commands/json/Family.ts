import type { PayloadCodec } from "#/codecs/PayloadCodec";
import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/json/index";
import type { JsonSetOptions, JsonGetOptions } from "#/commands/json/index";
import type { RedisArgument } from "#/RedisArgument";

export const jsonFamily = (executor: RedisExecutor) => ({
  jsonArrappend: (...args: Parameters<typeof Commands.jsonArrappend>) =>
    executor.execute(Commands.jsonArrappend(...args)),

  jsonArrappendLegacy: (...args: Parameters<typeof Commands.jsonArrappendLegacy>) =>
    executor.execute(Commands.jsonArrappendLegacy(...args)),

  jsonArrindex: (...args: Parameters<typeof Commands.jsonArrindex>) =>
    executor.execute(Commands.jsonArrindex(...args)),

  jsonArrindexLegacy: (...args: Parameters<typeof Commands.jsonArrindexLegacy>) =>
    executor.execute(Commands.jsonArrindexLegacy(...args)),

  jsonArrinsert: (...args: Parameters<typeof Commands.jsonArrinsert>) =>
    executor.execute(Commands.jsonArrinsert(...args)),

  jsonArrinsertLegacy: (...args: Parameters<typeof Commands.jsonArrinsertLegacy>) =>
    executor.execute(Commands.jsonArrinsertLegacy(...args)),

  jsonArrlen: (...args: Parameters<typeof Commands.jsonArrlen>) =>
    executor.execute(Commands.jsonArrlen(...args)),

  jsonArrlenLegacy: (...args: Parameters<typeof Commands.jsonArrlenLegacy>) =>
    executor.execute(Commands.jsonArrlenLegacy(...args)),

  jsonArrpop: (...args: Parameters<typeof Commands.jsonArrpop>) =>
    executor.execute(Commands.jsonArrpop(...args)),

  jsonArrpopExpanded: (...args: Parameters<typeof Commands.jsonArrpopExpanded>) =>
    executor.execute(Commands.jsonArrpopExpanded(...args)),

  jsonArrpopLegacy: (...args: Parameters<typeof Commands.jsonArrpopLegacy>) =>
    executor.execute(Commands.jsonArrpopLegacy(...args)),

  jsonArrtrim: (...args: Parameters<typeof Commands.jsonArrtrim>) =>
    executor.execute(Commands.jsonArrtrim(...args)),

  jsonArrtrimLegacy: (...args: Parameters<typeof Commands.jsonArrtrimLegacy>) =>
    executor.execute(Commands.jsonArrtrimLegacy(...args)),

  jsonClear: (...args: Parameters<typeof Commands.jsonClear>) =>
    executor.execute(Commands.jsonClear(...args)),

  jsonDebugMemory: (...args: Parameters<typeof Commands.jsonDebugMemory>) =>
    executor.execute(Commands.jsonDebugMemory(...args)),

  jsonDebugMemoryLegacy: (...args: Parameters<typeof Commands.jsonDebugMemoryLegacy>) =>
    executor.execute(Commands.jsonDebugMemoryLegacy(...args)),

  jsonDel: (...args: Parameters<typeof Commands.jsonDel>) =>
    executor.execute(Commands.jsonDel(...args)),

  jsonForget: (...args: Parameters<typeof Commands.jsonForget>) =>
    executor.execute(Commands.jsonForget(...args)),

  jsonGet: (...args: Parameters<typeof Commands.jsonGet>) =>
    executor.execute(Commands.jsonGet(...args)),

  jsonGetExpanded: (...args: Parameters<typeof Commands.jsonGetExpanded>) =>
    executor.execute(Commands.jsonGetExpanded(...args)),

  jsonGetExpandedOneLevel: (...args: Parameters<typeof Commands.jsonGetExpandedOneLevel>) =>
    executor.execute(Commands.jsonGetExpandedOneLevel(...args)),

  jsonMerge: (...args: Parameters<typeof Commands.jsonMerge>) =>
    executor.execute(Commands.jsonMerge(...args)),

  jsonMget: (...args: Parameters<typeof Commands.jsonMget>) =>
    executor.execute(Commands.jsonMget(...args)),

  jsonMset: (...args: Parameters<typeof Commands.jsonMset>) =>
    executor.execute(Commands.jsonMset(...args)),

  jsonNumincrby: (...args: Parameters<typeof Commands.jsonNumincrby>) =>
    executor.execute(Commands.jsonNumincrby(...args)),

  jsonNumincrbyLegacy: (...args: Parameters<typeof Commands.jsonNumincrbyLegacy>) =>
    executor.execute(Commands.jsonNumincrbyLegacy(...args)),

  jsonNummultby: (...args: Parameters<typeof Commands.jsonNummultby>) =>
    executor.execute(Commands.jsonNummultby(...args)),

  jsonNummultbyLegacy: (...args: Parameters<typeof Commands.jsonNummultbyLegacy>) =>
    executor.execute(Commands.jsonNummultbyLegacy(...args)),

  jsonNumpowby: (...args: Parameters<typeof Commands.jsonNumpowby>) =>
    executor.execute(Commands.jsonNumpowby(...args)),

  jsonNumpowbyLegacy: (...args: Parameters<typeof Commands.jsonNumpowbyLegacy>) =>
    executor.execute(Commands.jsonNumpowbyLegacy(...args)),

  jsonObjkeys: (...args: Parameters<typeof Commands.jsonObjkeys>) =>
    executor.execute(Commands.jsonObjkeys(...args)),

  jsonObjkeysLegacy: (...args: Parameters<typeof Commands.jsonObjkeysLegacy>) =>
    executor.execute(Commands.jsonObjkeysLegacy(...args)),

  jsonObjlen: (...args: Parameters<typeof Commands.jsonObjlen>) =>
    executor.execute(Commands.jsonObjlen(...args)),

  jsonObjlenLegacy: (...args: Parameters<typeof Commands.jsonObjlenLegacy>) =>
    executor.execute(Commands.jsonObjlenLegacy(...args)),

  jsonResp: (...args: Parameters<typeof Commands.jsonResp>) =>
    executor.execute(Commands.jsonResp(...args)),

  jsonSet: (...args: Parameters<typeof Commands.jsonSet>) =>
    executor.execute(Commands.jsonSet(...args)),

  jsonStrappend: (...args: Parameters<typeof Commands.jsonStrappend>) =>
    executor.execute(Commands.jsonStrappend(...args)),

  jsonStrappendLegacy: (...args: Parameters<typeof Commands.jsonStrappendLegacy>) =>
    executor.execute(Commands.jsonStrappendLegacy(...args)),

  jsonStrlen: (...args: Parameters<typeof Commands.jsonStrlen>) =>
    executor.execute(Commands.jsonStrlen(...args)),

  jsonStrlenLegacy: (...args: Parameters<typeof Commands.jsonStrlenLegacy>) =>
    executor.execute(Commands.jsonStrlenLegacy(...args)),

  jsonToggle: (...args: Parameters<typeof Commands.jsonToggle>) =>
    executor.execute(Commands.jsonToggle(...args)),

  jsonToggleLegacy: (...args: Parameters<typeof Commands.jsonToggleLegacy>) =>
    executor.execute(Commands.jsonToggleLegacy(...args)),

  jsonType: (...args: Parameters<typeof Commands.jsonType>) =>
    executor.execute(Commands.jsonType(...args)),

  jsonTypeLegacy: (...args: Parameters<typeof Commands.jsonTypeLegacy>) =>
    executor.execute(Commands.jsonTypeLegacy(...args)),

  jsonGetWith: <A, RD, RE>(
    key: RedisArgument,
    codec: PayloadCodec<A, RD, RE>,
    options?: JsonGetOptions,
  ) => executor.execute(Commands.jsonGetWith(key, codec, options)),

  jsonSetWith: <A, RD, RE>(
    key: RedisArgument,
    path: string,
    value: A,
    codec: PayloadCodec<A, RD, RE>,
    options?: Omit<JsonSetOptions, "format">,
  ) => executor.execute(Commands.jsonSetWith(key, path, value, codec, options)),
  jsonDebugHelp: () => executor.execute(Commands.jsonDebugHelp()),
});
