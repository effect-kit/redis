import { Effect, Predicate, Schema } from "effect";

import { CommandMetadata, Routing } from "#/command/Metadata";
import { CommandInputError } from "#/errors/CommandInputError";
import type { ReplyError } from "#/errors/ReplyError";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";

export type ReplyDecoder<A, E = never, R = never> = (
  reply: RespValue,
) => Effect.Effect<A, ReplyError | E, R>;

export interface PreparedCommand<A, E = never, R = never> {
  readonly metadata: CommandMetadata;
  readonly tokens: RedisCommand;
  readonly routing: Routing;
  readonly decode: ReplyDecoder<A, E, R>;
  readonly serverErrors: "fail" | "preserve";
}

export interface Command<A, E = never, RD = never, RE = never> {
  readonly prepare: Effect.Effect<PreparedCommand<A, E, RD>, CommandInputError | E, RE>;
}

export interface CommandDefinition<A, E = never, R = never> {
  readonly metadata: CommandMetadata;
  readonly tokens: RedisCommand;
  readonly routing: Routing;
  readonly decode: ReplyDecoder<A, E, R>;
  readonly serverErrors?: "fail" | "preserve";
}

const Arguments = Schema.NonEmptyArray(Schema.Union([Schema.String, Schema.Uint8Array]));

const parseMetadata = Schema.decodeUnknownEffect(CommandMetadata, { onExcessProperty: "error" });
const parseRouting = Schema.decodeUnknownEffect(Routing, { onExcessProperty: "error" });
const parseServerErrors = Schema.decodeUnknownEffect(Schema.Literals(["fail", "preserve"]));
const parseArguments = Schema.decodeUnknownEffect(Arguments);

/** Preparation validates intent; connection admission snapshots bytes within its wire budget. */
export const defineCommand = <A, E = never, R = never>(
  definition: CommandDefinition<A, E, R>,
): Command<A, E, R> => ({
  prepare: Effect.gen(function* () {
    if (!Predicate.isFunction(definition.decode))
      return yield* new CommandInputError({ delivery: "unsent", reason: "metadata" });

    const serverErrors = yield* parseServerErrors(
      definition.serverErrors === undefined ? "fail" : definition.serverErrors,
    ).pipe(
      Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "metadata" })),
    );
    const metadata = yield* parseMetadata(definition.metadata).pipe(
      Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "metadata" })),
    );
    const routing = yield* parseRouting(definition.routing).pipe(
      Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "routing" })),
    );
    const tokens = yield* parseArguments(definition.tokens).pipe(
      Effect.mapError(() => new CommandInputError({ delivery: "unsent", reason: "arguments" })),
    );

    if (routing._tag === "Keys" && routing.keys.some((key) => key.index >= tokens.length))
      return yield* new CommandInputError({ delivery: "unsent", reason: "routing" });

    const [first, ...rest] = tokens;

    return {
      metadata,
      routing,
      tokens: [first, ...rest] satisfies RedisCommand,
      decode: definition.decode,
      serverErrors,
    };
  }),
});

/** Keeps effectful payload preparation and decoder service requirements on the command. */
export const fromPreparation = <A, E = never, RD = never, RE = never>(
  prepare: Effect.Effect<PreparedCommand<A, E, RD>, CommandInputError | E, RE>,
): Command<A, E, RD, RE> => ({ prepare });
