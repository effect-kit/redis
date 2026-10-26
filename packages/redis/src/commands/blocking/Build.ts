import { Effect } from "effect";

import { defineCommand, fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import type { CommandMetadata } from "#/command/Metadata";
import { blockingTiming } from "#/commands/blocking/Timing";
import type { BlockingOptions } from "#/commands/blocking/Timing";
import type { Intent } from "#/commands/internal/Command";
import type { CommandInputError } from "#/errors/CommandInputError";

export const blocking = <A>(
  info: CommandMetadata,
  decode: ReplyDecoder<A>,
  options: BlockingOptions,
  intent: (timeout: string) => Effect.Effect<Intent, CommandInputError>,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const { token, replyTimeoutMillis } = yield* blockingTiming(options);
      const prepared = yield* intent(token);

      return yield* defineCommand({
        ...prepared,
        metadata: { ...info, execution: "blocking" },
        decode,
        replyTimeoutMillis,
      }).prepare;
    }),
  );
