import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { decimalToken, nullable } from "#/command/reply/Data";
import { mismatch, text, undecorate } from "#/command/reply/Scalars";
import type { JsonMatches } from "#/commands/json/Path";
import type { RespValue } from "#/protocol/RespValue";

const numericToken: ReplyDecoder<string> = (reply) => {
  const value = undecorate(reply);
  return value._tag === "Integer" ? Effect.succeed(String(value.value)) : decimalToken(reply);
};

/** Parse only the numeric mutation grammar, retaining decimal tokens before any JS number conversion. */
export const numericMatches: ReplyDecoder<JsonMatches<string>> = (reply) => {
  const value = undecorate(reply);
  if (value._tag === "Null") return Effect.succeed(Option.none());
  if (value._tag === "Array")
    return array(nullable(numericToken))(value).pipe(Effect.map(Option.some));

  return text(reply).pipe(
    Effect.flatMap((encoded) => {
      const trimmed = encoded.trim();
      if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
        return Effect.fail(mismatch("array", reply));

      const body = trimmed.slice(1, -1).trim();
      return Effect.forEach(body === "" ? [] : body.split(","), (token) => {
        const selected = token.trim();
        return selected === "null"
          ? Effect.succeed(Option.none<string>())
          : numericToken({ _tag: "BlobString", value: new TextEncoder().encode(selected) }).pipe(
              Effect.map(Option.some),
            );
      }).pipe(Effect.map(Option.some));
    }),
  );
};

export type JsonNumericLegacy =
  | { readonly _tag: "Scalar"; readonly value: Option.Option<string> }
  | { readonly _tag: "Matches"; readonly values: ReadonlyArray<Option.Option<string>> };

/** Redis RESP3 applies matching-path semantics even to a legacy numeric path. Preserve every result. */
export const numericLegacy: ReplyDecoder<JsonNumericLegacy> = (reply: RespValue) =>
  undecorate(reply)._tag === "Array"
    ? array(nullable(numericToken))(reply).pipe(
        Effect.map((values): JsonNumericLegacy => ({ _tag: "Matches", values })),
      )
    : nullable(numericToken)(reply).pipe(
        Effect.map((value): JsonNumericLegacy => ({ _tag: "Scalar", value })),
      );
