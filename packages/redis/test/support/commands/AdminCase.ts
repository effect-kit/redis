import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import type { Command } from "#/command/Command";
import type { RedisCommand, RespValue } from "#/index";

export interface AdminCase {
  readonly command: Command<unknown>;
  readonly tokens: RedisCommand;
  readonly reply: RespValue;
  readonly expected: unknown;
  readonly execution?: "ordinary" | "exclusive";
}

export const adminCases = (group: string, cases: ReadonlyArray<AdminCase>) => {
  for (const scenario of cases) {
    it.effect(
      `ADMIN ${group}: ${scenario.tokens.slice(0, 2).join(" ")} reviewed wire and result`,
      () =>
        Effect.gen(function* () {
          const prepared = yield* scenario.command.prepare;

          expect(prepared.tokens).toEqual(scenario.tokens);
          expect(prepared.metadata.execution).toBe(scenario.execution ?? "exclusive");
          expect(prepared.metadata.replay).toBe("never");
          const result = yield* prepared.decode(scenario.reply);
          const decoded = Redacted.isRedacted(result) ? Redacted.value(result) : result;
          expect(decoded).toEqual(scenario.expected);
        }),
    );
  }
};
