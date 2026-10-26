import { Effect, Schema } from "effect";

import { defineCommand, fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import { keyIndexes } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const Invocation = Schema.Struct({
  keys: Schema.Array(Argument),
  args: Schema.optionalKey(Schema.Array(Argument)),
});
export type ScriptArguments = typeof Invocation.Type;

export type InvocationName = "EVAL" | "EVALSHA" | "EVAL_RO" | "EVALSHA_RO" | "FCALL" | "FCALL_RO";

/** Keys are declared by the caller; Lua source cannot establish a safe routing contract. */
export const invocation = <A, E, R>(
  name: InvocationName,
  body: RedisArgument,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(Invocation, input);
      const script = yield* parse(Argument, body);
      const readOnly = name.endsWith("_RO");

      return yield* defineCommand({
        metadata: metadata(
          name,
          "scripting",
          ["SCRIPT"],
          [name.startsWith("FCALL") || readOnly ? "Since 7.0.0" : "Since 2.6.0"],
        ),
        tokens: [
          name,
          script,
          String(selected.keys.length),
          ...selected.keys,
          ...(selected.args ?? []),
        ],
        routing: keyIndexes(
          selected.keys.map((_, index) => index + 3),
          readOnly ? "read" : "read-write",
        ),
        decode,
      }).prepare;
    }),
  );

export const evalScript = <A, E, R>(
  source: RedisArgument,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("EVAL", source, input, decode);

export const evalSha = <A, E, R>(
  sha: string,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("EVALSHA", sha, input, decode);

export const evalReadOnly = <A, E, R>(
  source: RedisArgument,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("EVAL_RO", source, input, decode);

export const evalShaReadOnly = <A, E, R>(
  sha: string,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("EVALSHA_RO", sha, input, decode);

export const fcall = <A, E, R>(
  name: RedisArgument,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("FCALL", name, input, decode);

export const fcallReadOnly = <A, E, R>(
  name: RedisArgument,
  input: ScriptArguments,
  decode: ReplyDecoder<A, E, R>,
) => invocation("FCALL_RO", name, input, decode);
