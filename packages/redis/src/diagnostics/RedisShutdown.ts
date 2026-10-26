import { Cause, Context, Effect, Exit, Layer, Schema } from "effect";

import { checkServerReply } from "#/command/Decode";
import { mismatch, status } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import type { ConnectionOptions } from "#/connection/Options";
import { AdmissionError } from "#/errors/AdmissionError";
import { makeEventOwner } from "#/events/Owner";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisConfig } from "#/RedisConfig";
import type { Transport } from "#/transport/Transport";

const Options = Schema.Struct({
  save: Schema.optionalKey(Schema.Literals(["SAVE", "NOSAVE"])),
  now: Schema.optionalKey(Schema.Boolean),
  force: Schema.optionalKey(Schema.Boolean),
});
export type ShutdownOptions = typeof Options.Type;

export interface ShutdownConnectionOptions<R = never> {
  readonly credentials?: ConnectionOptions<R>["credentials"];
}

/** A clean EOF is observable; it cannot prove whether this request caused shutdown. */
export interface ShutdownClosed {
  readonly _tag: "ConnectionClosed";
  readonly execution: "unknown";
}

export const makeRedisShutdown = Effect.fnUntraced(function* <R = never>(
  config: RedisConfig,
  options: ShutdownConnectionOptions<R> = {},
) {
  const context = yield* Effect.context<R | Transport>();
  // ABORT needs its own socket while shutdown is pending; each lane admits one caller.
  let shuttingDown = false;
  let aborting = false;
  let poison: Cause.Cause<never> | undefined;

  const request = <A>(tokens: RedisCommand, abort: boolean, closed: A) =>
    Effect.acquireUseRelease(
      Effect.suspend(() => {
        if (poison !== undefined) return Effect.failCause(poison);
        if (abort ? aborting : shuttingDown)
          return Effect.fail(new AdmissionError({ reason: "count", delivery: "unsent" }));
        if (abort) aborting = true;
        else shuttingDown = true;
        return Effect.void;
      }),
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const owner = yield* makeEventOwner(
              config,
              options.credentials === undefined ? {} : { credentials: options.credentials },
              () => Effect.succeed(false),
              () => {},
              1,
            );
            const wire = yield* owner.open;

            // Recovery is limited to EOF from the owned request, never handshake/open failures.
            return yield* wire.request(tokens).pipe(
              Effect.flatMap(checkServerReply),
              Effect.flatMap((reply) =>
                abort
                  ? status("OK")(reply).pipe(Effect.as(closed))
                  : Effect.fail(mismatch("custom", reply)),
              ),
              Effect.catchTag("ConnectionError", (error) =>
                !abort && error.reason === "closed" ? Effect.succeed(closed) : Effect.fail(error),
              ),
            );
          }),
        ).pipe(
          Effect.provideContext(context),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit) && Cause.hasDies(exit.cause))
                poison = Cause.fromReasons<never>(exit.cause.reasons.filter(Cause.isDieReason));
            }),
          ),
        ),
      () =>
        Effect.sync(() => {
          if (abort) aborting = false;
          else shuttingDown = false;
        }),
    );

  const shutdown = Effect.fnUntraced(function* (input: ShutdownOptions = {}) {
    const selected = yield* parse(Options, input);
    const result: ShutdownClosed = { _tag: "ConnectionClosed", execution: "unknown" };

    return yield* request(
      [
        "SHUTDOWN",
        ...(selected.save === undefined ? [] : [selected.save]),
        ...(selected.now ? ["NOW"] : []),
        ...(selected.force ? ["FORCE"] : []),
      ],
      false,
      result,
    );
  });

  return { shutdown, abort: () => request(["SHUTDOWN", "ABORT"], true, undefined) };
});

export type RedisShutdownClient = Effect.Success<ReturnType<typeof makeRedisShutdown>>;

export class RedisShutdown extends Context.Service<RedisShutdown, RedisShutdownClient>()(
  "@effect-kit/redis/RedisShutdown",
) {
  static layer<R = never>(config: RedisConfig, options?: ShutdownConnectionOptions<R>) {
    return Layer.effect(RedisShutdown, makeRedisShutdown(config, options));
  }
}
