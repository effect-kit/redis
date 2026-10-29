import type { Effect, Redacted, Result } from "effect";

import type { Command, PreparedCommand } from "#/command/Command";
import type { RedisError } from "#/command/Executor";
import type { BatchError } from "#/errors/BatchError";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { ReplyError } from "#/errors/ReplyError";
import type { ServerError } from "#/errors/ServerError";
import type { SessionError } from "#/errors/SessionError";
import type { TransactionError } from "#/errors/TransactionError";
import type { RespValue } from "#/protocol/RespValue";

export type AnyCommand = Command<unknown, unknown, unknown, unknown>;
export type CommandValue<C> =
  C extends Command<infer A, infer _E, infer _RD, infer _RE> ? A : never;
export type CommandFailure<C> =
  C extends Command<infer _A, infer E, infer _RD, infer _RE> ? E : never;
export type DecodeRequirements<C> =
  C extends Command<infer _A, infer _E, infer RD, infer _RE> ? RD : never;
export type PrepareRequirements<C> =
  C extends Command<infer _A, infer _E, infer _RD, infer RE> ? RE : never;

export type BatchValues<Cs extends ReadonlyArray<AnyCommand>> = {
  readonly [K in keyof Cs]: CommandValue<Cs[K]>;
};

export type BatchResults<Cs extends ReadonlyArray<AnyCommand>> = {
  readonly [K in keyof Cs]: Result.Result<
    CommandValue<Cs[K]>,
    ServerError | ReplyError | CommandFailure<Cs[K]>
  >;
};

export type BatchSlot<A, E> =
  | {
      readonly _tag: "Completed";
      readonly index: number;
      readonly result: Result.Result<A, ServerError | ReplyError | E>;
    }
  | {
      readonly _tag: "Replied";
      readonly index: number;
      readonly reply: Redacted.Redacted<RespValue>;
    }
  | {
      readonly _tag: "Unsent" | "Unknown";
      readonly index: number;
      readonly error: Redacted.Redacted<unknown>;
    };

export type BatchOutcomes<Cs extends ReadonlyArray<AnyCommand>> = {
  readonly [K in keyof Cs]: BatchSlot<CommandValue<Cs[K]>, CommandFailure<Cs[K]>>;
};

export type PartialBatchError<Cs extends ReadonlyArray<AnyCommand>> = Omit<
  BatchError,
  "outcomes"
> & { readonly outcomes: Redacted.Redacted<BatchOutcomes<Cs>> };

export type PreparedBatch<Cs extends ReadonlyArray<AnyCommand>> = ReadonlyArray<
  PreparedCommand<unknown, CommandFailure<Cs[number]>, DecodeRequirements<Cs[number]>>
>;

export type BatchRequirements<Cs extends ReadonlyArray<AnyCommand>> =
  | PrepareRequirements<Cs[number]>
  | DecodeRequirements<Cs[number]>;

export type BatchFailure<Cs extends ReadonlyArray<AnyCommand>> =
  | RedisError
  | SessionError
  | CommandInputError
  | CommandFailure<Cs[number]>
  | PartialBatchError<Cs>;

export interface BatchExecutorService {
  readonly pipeline: <const Cs extends ReadonlyArray<AnyCommand>>(
    commands: Cs,
  ) => Effect.Effect<BatchResults<Cs>, BatchFailure<Cs>, BatchRequirements<Cs>>;
  readonly transaction: <const Cs extends ReadonlyArray<AnyCommand>>(
    commands: Cs,
  ) => Effect.Effect<
    TransactionOutcome<Cs>,
    BatchFailure<Cs> | TransactionError,
    BatchRequirements<Cs>
  >;
}

export type TransactionOutcome<Cs extends ReadonlyArray<AnyCommand>> =
  | { readonly _tag: "Committed"; readonly results: BatchResults<Cs> }
  | { readonly _tag: "Conflict" };
