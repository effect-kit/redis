import { Effect, Option } from "effect";

import { fromPreparation } from "#/command/Command";
import type { Command, PreparedCommand } from "#/command/Command";
import type { RedisExecutor } from "#/command/Executor";
import { getBytes } from "#/commands/strings/Get";
import { set } from "#/commands/strings/Set";
import { decodeWriteSetOptions } from "#/commands/strings/SetOptions";
import type { WriteSetOptions, WriteSetResult } from "#/commands/strings/SetOptions";
import { CommandInputError } from "#/errors/CommandInputError";
import type { PayloadError } from "#/errors/PayloadError";
import type { RedisKey } from "#/keys/RedisKey";

export const getKey = <A, RD, RE>(
  key: RedisKey<A, RD, RE>,
): Command<Option.Option<A>, PayloadError, RD> =>
  fromPreparation(
    Effect.gen(function* () {
      const prepared = yield* getBytes(key.name).prepare;
      return {
        ...prepared,
        decode: (reply) =>
          prepared
            .decode(reply)
            .pipe(
              Effect.flatMap((value) =>
                Option.isNone(value)
                  ? Effect.succeed(Option.none<A>())
                  : key.codec.decode(value.value).pipe(Effect.map(Option.some)),
              ),
            ),
      } satisfies PreparedCommand<Option.Option<A>, PayloadError, RD>;
    }),
  );
export function setKey<A, RD, RE, O extends WriteSetOptions = {}>(
  key: RedisKey<A, RD, RE>,
  value: NoInfer<A>,
  options?: O,
): Command<WriteSetResult<O>, PayloadError, never, RE>;
export function setKey<A, RD, RE>(
  key: RedisKey<A, RD, RE>,
  value: NoInfer<A>,
  options?: WriteSetOptions,
): Command<void | boolean, PayloadError, never, RE> {
  return fromPreparation(
    Effect.gen(function* () {
      const parsed = yield* decodeWriteSetOptions(options ?? {}).pipe(
        Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "options" })),
      );
      const bytes = yield* key.codec.encode(value);
      return yield* set(key.name, bytes, parsed).prepare;
    }),
  );
}
export const keyFamily = (executor: RedisExecutor) => ({
  getKey: <A, RD, RE>(key: RedisKey<A, RD, RE>) => executor.execute(getKey(key)),
  setKey: <A, RD, RE, O extends WriteSetOptions = {}>(
    key: RedisKey<A, RD, RE>,
    value: NoInfer<A>,
    options?: O,
  ) => executor.execute(setKey(key, value, options)),
});
