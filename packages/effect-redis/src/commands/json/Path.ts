import { Effect, Schema } from "effect";
import type { Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable } from "#/command/reply/Data";
import { parse } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type JsonPath = `$${string}`;
export type JsonMatches<A> = Option.Option<ReadonlyArray<Option.Option<A>>>;
export const MatchPath = Schema.String.check(Schema.isPattern(/^\$/));
export const LegacyPath = Schema.NonEmptyString.check(
  Schema.makeFilter((path) => !path.startsWith("$")),
);

/** A missing key, no path matches and a nonmatching value type are separate receipts. */
export const matching = <A>(
  name: string,
  key: RedisArgument,
  path: JsonPath,
  decode: ReplyDecoder<A>,
  tail: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
  access: "read" | "read-write" = "read",
) =>
  moduleKeyed(
    "json",
    name,
    key,
    nullable(array(nullable(decode))),
    Effect.gen(function* () {
      const selected = yield* parse(MatchPath, path);
      const rest = yield* tail;
      return [selected, ...rest];
    }),
    access,
  );

export const legacy = <A>(
  name: string,
  key: RedisArgument,
  path: string,
  decode: ReplyDecoder<A>,
  tail: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
  access: "read" | "read-write" = "read",
) =>
  moduleKeyed(
    "json",
    name,
    key,
    nullable(decode),
    Effect.gen(function* () {
      const selected = yield* parse(LegacyPath, path);
      const rest = yield* tail;
      return [selected, ...rest];
    }),
    access,
  );
