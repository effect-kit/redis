import { Context, Effect } from "effect";
import type { Crypto } from "effect";

import { Commands, RedisScript, Reply } from "#/index";
import type { RedisClient, RedisScriptsClient } from "#/index";

class DecoderContext extends Context.Service<DecoderContext, { readonly label: string }>()(
  "ScriptDecoder",
) {}
declare const redis: RedisClient;
declare const scripts: RedisScriptsClient;
const decoder = () => DecoderContext.pipe(Effect.map((service) => service.label));
const descriptor = RedisScript.make({ source: "return 1", decode: decoder });
declare const script: Effect.Success<typeof descriptor>;
const executed = scripts.execute(script, { keys: [new Uint8Array([255])], args: ["arg"] });
const direct = redis.evalScript("return 1", { keys: [] }, decoder);
const prepared = Commands.fcall("f", { keys: [] }, Reply.integer);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type ScriptingContracts = [
  Assert<Equal<Effect.Services<typeof descriptor>, Crypto.Crypto>>,
  Assert<Equal<Effect.Services<typeof executed>, DecoderContext>>,
  Assert<Equal<Effect.Success<typeof executed>, string>>,
  Assert<Equal<Effect.Services<typeof direct>, DecoderContext>>,
  Assert<Equal<Effect.Success<typeof direct>, string>>,
  Assert<Equal<Effect.Services<typeof prepared.prepare>, never>>,
];

// @ts-expect-error Results require an actual decoder, never an asserted generic type.
Commands.evalScript<number>("return 1", { keys: [] });
// @ts-expect-error Keys are explicit, even for keyless scripts.
Commands.fcall("f", {}, Reply.integer);
// @ts-expect-error Binary data must remain bytes or explicitly encoded text.
Commands.evalSha("sha", { keys: [], args: [12] }, Reply.integer);
// @ts-expect-error SCRIPT EXISTS requires at least one digest.
Commands.scriptExists([]);
