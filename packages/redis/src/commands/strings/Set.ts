import { Effect } from "effect";
import type { Option } from "effect";

import { fromPreparation } from "#/command/Command";
import type { Command, ReplyDecoder } from "#/command/Command";
import { blob, mismatch, optional, status, undecorate } from "#/command/reply/Scalars";
import { singleKeyCommand } from "#/command/SingleKey";
import { metadata } from "#/commands/Metadata";
import { decodeSetOptions } from "#/commands/strings/SetOptions";
import type { SetOptions, SetResult } from "#/commands/strings/SetOptions";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export const setMetadata = metadata(
  "SET",
  "strings",
  ["COMMAND-06", "COMMAND-07", "COMMAND-08"],
  [
    "GET/EXAT/PXAT require Redis/Valkey 6.2+; NX+GET requires Redis/Valkey 7.0+",
    "IFEQ requires Redis 8.4+ or Valkey 8.1+; IFNE/IFDEQ/IFDNE require Redis 8.4+ and are absent in Valkey 9.1.2",
  ],
);

type AnySetResult = void | boolean | Option.Option<Uint8Array>;

const replyDecoder =
  (options: SetOptions): ReplyDecoder<AnySetResult> =>
  (reply) => {
    // GET returns the previous bytes even when a condition prevents the write.
    if (options.get === true) return optional(blob)(reply);

    const value = undecorate(reply);

    if (value._tag === "Null" && value.kind !== "array")
      return options.condition === undefined
        ? Effect.fail(mismatch("set-result", reply))
        : Effect.succeed(false);

    return status("OK")(reply).pipe(
      Effect.map(() => (options.condition === undefined ? undefined : true)),
    );
  };

export function set<O extends SetOptions = {}>(
  key: RedisArgument,
  value: RedisArgument,
  options?: O,
): Command<SetResult<O>>;
export function set(
  key: RedisArgument,
  value: RedisArgument,
  options?: SetOptions,
): Command<AnySetResult> {
  return fromPreparation(
    Effect.gen(function* () {
      const parsed = yield* decodeSetOptions(options ?? {}).pipe(
        Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "options" })),
      );

      const args: RedisArgument[] = [];
      const condition = parsed.condition;

      if (typeof condition === "string") args.push(condition);
      else if (condition !== undefined)
        args.push(condition.type, "value" in condition ? condition.value : condition.digest);

      if (parsed.get === true) args.push("GET");

      if (parsed.expiry !== undefined) {
        args.push(parsed.expiry.type);
        if (parsed.expiry.type !== "KEEPTTL") args.push(parsed.expiry.value.toString());
      }

      const decode = replyDecoder(parsed);

      return yield* singleKeyCommand(setMetadata, key, [value, ...args], "read-write", decode)
        .prepare;
    }),
  );
}
