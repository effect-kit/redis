import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Command } from "#/command/Command";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";

export interface CommandCase {
  readonly label: string;
  readonly command: Command<unknown>;
  readonly tokens: RedisCommand;
  readonly reply: RespValue;
  readonly expected: unknown;
  readonly keys: ReadonlyArray<number>;
}

export const bytes = (value: string) => new TextEncoder().encode(value);
export const blob = (value: string): RespValue => ({ _tag: "BlobString", value: bytes(value) });
export const integer = (value: bigint): RespValue => ({ _tag: "Integer", value });
export const array = (...values: RespValue[]): RespValue => ({ _tag: "Array", values });
export const ok: RespValue = { _tag: "SimpleString", value: bytes("OK") };
export const missing: RespValue = { _tag: "Null", kind: "bulk" };

/** Expectations are authored independently of the production encoder and decoder. */
export const commandCases = (family: string, cases: ReadonlyArray<CommandCase>) => {
  it.effect.each(cases)(
    `${family}: $label encodes, routes and decodes the reviewed contract`,
    ({ command, tokens, reply, expected, keys }) =>
      Effect.gen(function* () {
        const prepared = yield* command.prepare;

        expect(prepared.tokens).toEqual(tokens);
        expect(prepared.metadata.name).toBe(
          tokens[0] === "OBJECT" ? `OBJECT ${String(tokens[1])}` : tokens[0],
        );
        expect(
          prepared.routing._tag === "Keys" || prepared.routing._tag === "Dynamic"
            ? prepared.routing.keys.map((key) => key.index)
            : [],
        ).toEqual(keys);
        expect(prepared.metadata.execution).toBe("ordinary");
        expect(prepared.metadata.replay).toBe("never");
        expect(yield* prepared.decode(reply)).toEqual(expected);
      }),
  );
};
