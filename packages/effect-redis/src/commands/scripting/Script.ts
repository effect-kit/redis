import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, simpleText, withLength } from "#/command/reply/Data";
import { blob, status, text } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

export const ScriptFlushMode = Schema.Literals(["SYNC", "ASYNC"]);
export type ScriptFlushMode = typeof ScriptFlushMode.Type;

export const scriptLoad = (source: RedisArgument) =>
  ordinary(
    metadata("SCRIPT LOAD", "scripting", ["SCRIPT"]),
    text,
    parse(Argument, source).pipe(
      Effect.map((body) => ({
        tokens: ["SCRIPT", "LOAD", body] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

export const scriptExists = (digests: ReadonlyArray<string>) => ({
  prepare: Effect.gen(function* () {
    const values = yield* parse(Schema.Array(Schema.String), digests);

    return yield* ordinary(
      metadata("SCRIPT EXISTS", "scripting", ["SCRIPT"]),
      withLength(values.length, array(boolean)),
      Effect.succeed({
        tokens: ["SCRIPT", "EXISTS", ...values],
        routing: { _tag: "Keyless" },
      }),
    ).prepare;
  }),
});

export const scriptFlush = (mode?: ScriptFlushMode) =>
  ordinary(
    metadata("SCRIPT FLUSH", "scripting", ["SCRIPT"]),
    status("OK"),
    parse(Schema.optional(ScriptFlushMode), mode).pipe(
      Effect.map((selected) => ({
        tokens: ["SCRIPT", "FLUSH", ...(selected === undefined ? [] : [selected])] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

export const scriptKill = () =>
  ordinary(
    metadata("SCRIPT KILL", "scripting", ["SCRIPT"]),
    status("OK"),
    Effect.succeed({ tokens: ["SCRIPT", "KILL"], routing: { _tag: "Keyless" } }),
  );

export const scriptHelp = () =>
  ordinary(
    metadata("SCRIPT HELP", "scripting", ["SCRIPT"]),
    array(simpleText),
    Effect.succeed({ tokens: ["SCRIPT", "HELP"], routing: { _tag: "Keyless" } }),
  );

/** Valkey extension. An absent digest remains a server error rather than a fabricated body. */
export const scriptShow = (digest: string) =>
  ordinary(
    metadata("SCRIPT SHOW", "scripting", ["SCRIPT"], ["Valkey extension"]),
    blob,
    parse(Schema.String, digest).pipe(
      Effect.map((sha) => ({
        tokens: ["SCRIPT", "SHOW", sha] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );
