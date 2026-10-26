import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { pairs, simpleText } from "#/command/reply/Data";
import { mismatch } from "#/command/reply/Scalars";
import { moduleDouble } from "#/commands/modules/Reply";
import type { RespValue } from "#/protocol/RespValue";

export const fields = pairs(simpleText, Effect.succeed);

export const field = (
  entries: ReadonlyArray<readonly [string, RespValue]>,
  name: string,
  reply: RespValue,
) => {
  const matches = entries.filter(([key]) => key === name);
  const value = matches[0]?.[1];
  return matches.length === 1 && value !== undefined
    ? Effect.succeed(value)
    : Effect.fail(mismatch("custom", reply));
};

export const literal =
  <const S extends ReadonlyArray<string>>(choices: S): ReplyDecoder<S[number]> =>
  (reply) =>
    simpleText(reply).pipe(
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(Schema.Literals(choices))(value).pipe(
          Effect.mapError(() => mismatch("custom", reply)),
        ),
      ),
    );

export const finiteScore: ReplyDecoder<number> = (reply) =>
  moduleDouble(reply).pipe(
    Effect.flatMap((value) =>
      Number.isFinite(value) ? Effect.succeed(value) : Effect.fail(mismatch("score", reply)),
    ),
  );
