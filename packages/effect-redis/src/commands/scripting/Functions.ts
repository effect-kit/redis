import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { pairs, simpleText } from "#/command/reply/Data";
import { blob, status, text } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import { ScriptFlushMode } from "#/commands/scripting/Script";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisArgument } from "#/RedisArgument";

const lossless = (reply: RespValue) => Effect.succeed(reply);
const fields = pairs(text, lossless);
const ListOptions = Schema.Struct({
  libraryName: Schema.optionalKey(Argument),
  withCode: Schema.optionalKey(Schema.Boolean),
});
export type FunctionListOptions = typeof ListOptions.Type;

const command = <A>(
  name: string,
  decode: ReplyDecoder<A>,
  tail: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
) =>
  ordinary(
    metadata(`FUNCTION ${name}`, "scripting", ["SCRIPT"], ["Since 7.0.0"]),
    decode,
    tail.pipe(
      Effect.map((args) => ({
        tokens: ["FUNCTION", name, ...args] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

/** Unknown library/function fields stay lossless across server versions. */
export const functionList = (options: FunctionListOptions = {}) =>
  command(
    "LIST",
    array(fields),
    parse(ListOptions, options).pipe(
      Effect.map((selected) => [
        ...(selected.libraryName === undefined ? [] : ["LIBRARYNAME", selected.libraryName]),
        ...(selected.withCode ? ["WITHCODE"] : []),
      ]),
    ),
  );

export const functionLoad = (source: RedisArgument, replace = false) =>
  command(
    "LOAD",
    // Kvrocks acknowledges loading with an empty simple string; preserve it instead of inventing a name.
    simpleText,
    parse(Schema.Tuple([Argument, Schema.Boolean]), [source, replace]).pipe(
      Effect.map(([body, overwrite]) => [...(overwrite ? ["REPLACE"] : []), body]),
    ),
  );

export const functionDelete = (name: RedisArgument) =>
  command("DELETE", status("OK"), parse(Argument, name).pipe(Effect.map((value) => [value])));

export const functionDump = () => command("DUMP", blob);

export const functionRestore = (payload: Uint8Array, policy?: "FLUSH" | "APPEND" | "REPLACE") =>
  command(
    "RESTORE",
    status("OK"),
    parse(
      Schema.Tuple([
        Schema.Uint8Array,
        Schema.optional(Schema.Literals(["FLUSH", "APPEND", "REPLACE"])),
      ]),
      [payload, policy],
    ).pipe(
      Effect.map(([bytes, selected]) => [bytes, ...(selected === undefined ? [] : [selected])]),
    ),
  );

export const functionFlush = (mode?: ScriptFlushMode) =>
  command(
    "FLUSH",
    status("OK"),
    parse(Schema.optional(ScriptFlushMode), mode).pipe(
      Effect.map((selected) => (selected === undefined ? [] : [selected])),
    ),
  );

export const functionKill = () => command("KILL", status("OK"));

export const functionHelp = () => command("HELP", array(simpleText));

export const functionStats = () => command("STATS", fields);
