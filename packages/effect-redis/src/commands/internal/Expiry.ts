import { Effect, Schema } from "effect";

import { parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type Expiry =
  | { readonly type: "EX" | "PX" | "EXAT" | "PXAT"; readonly value: Integer }
  | { readonly type: "PERSIST" };
export const Expiry = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["EX", "PX", "EXAT", "PXAT"]), value: Positive }),
  Schema.Struct({ type: Schema.Literal("PERSIST") }),
]);

export const expiryTokens = (
  expiry: Expiry | undefined,
): Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> =>
  expiry === undefined
    ? Effect.succeed([])
    : parse(Expiry, expiry).pipe(
        Effect.map((parsed) =>
          parsed.type === "PERSIST" ? ["PERSIST"] : [parsed.type, String(parsed.value)],
        ),
      );
