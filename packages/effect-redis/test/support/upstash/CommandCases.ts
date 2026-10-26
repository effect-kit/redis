import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Command } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";

interface ExtensionCase {
  readonly label: string;
  readonly command: Command<unknown, unknown>;
  readonly tokens: RedisCommand;
  readonly reply: RespValue;
  readonly expected: unknown;
}

export const extensionCases = (family: string, cases: ReadonlyArray<ExtensionCase>) =>
  it.effect.each(cases)(
    `${family}: $label prepares and decodes the provider contract`,
    ({ command, tokens, reply, expected }) =>
      Effect.gen(function* () {
        const prepared = yield* command.prepare;
        expect(prepared.tokens).toEqual(tokens);
        expect(prepared.metadata.name).toBe(tokens[0] === "ACL" ? "ACL RESTTOKEN" : tokens[0]);
        expect(prepared.metadata.replay).toBe("never");
        expect(prepared.metadata.availability[0]).toContain("Upstash");
        expect(prepared.routing).toEqual(
          String(tokens[0]).startsWith("VECTOR.")
            ? {
                _tag: "Keys",
                keys: [
                  {
                    index: 1,
                    access: ["VECTOR.GET", "VECTOR.QUERY", "VECTOR.INFO", "VECTOR.COUNT"].includes(
                      String(tokens[0]),
                    )
                      ? "read"
                      : "read-write",
                  },
                ],
              }
            : { _tag: "Keyless" },
        );

        expect(yield* decodeReply(prepared, reply)).toEqual(expected);
      }),
  );
