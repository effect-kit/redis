import { Effect, Option, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable } from "#/command/reply/Data";
import { keyed } from "#/commands/internal/Command";
import { Argument, parse, NonNegative, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { StreamId, StreamPosition, streamId } from "#/commands/streams/Id";
import { groupEntry } from "#/commands/streams/reply/Entries";
import { at, elements } from "#/commands/streams/reply/Structure";
import type { StreamIds } from "#/commands/streams/Retention";
import type { ClaimPage } from "#/commands/streams/Types";
import type { RedisArgument } from "#/RedisArgument";

const Options = Schema.Struct({
  deliveryTime: Schema.optionalKey(
    Schema.Struct({ type: Schema.Literals(["IDLE", "TIME"]), millis: NonNegative }),
  ),
  retryCount: Schema.optionalKey(NonNegative),
  force: Schema.optionalKey(Schema.Boolean),
  lastId: Schema.optionalKey(StreamId),
});
export type ClaimOptions = typeof Options.Type;

const claim = <A>(
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  ids: StreamIds,
  options: ClaimOptions,
  decode: ReplyDecoder<ReadonlyArray<A>>,
  justId: boolean,
) =>
  keyed(
    catalog.XCLAIM,
    key,
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      return [
        yield* parse(Argument, group),
        yield* parse(Argument, consumer),
        String(yield* parse(NonNegative, minIdleMillis)),
        ...(yield* parse(Schema.NonEmptyArray(StreamId), ids)),
        ...(selected.deliveryTime === undefined
          ? []
          : [selected.deliveryTime.type, String(selected.deliveryTime.millis)]),
        ...(selected.retryCount === undefined ? [] : ["RETRYCOUNT", String(selected.retryCount)]),
        ...(selected.force ? ["FORCE"] : []),
        ...(justId ? ["JUSTID"] : []),
        ...(selected.lastId === undefined ? [] : ["LASTID", selected.lastId]),
      ];
    }),
    decode,
    "read-write",
  );

export const xclaim = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  ids: StreamIds,
  options: ClaimOptions = {},
) => claim(key, group, consumer, minIdleMillis, ids, options, array(nullable(groupEntry)), false);

export const xclaimIds = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  ids: StreamIds,
  options: ClaimOptions = {},
) => claim(key, group, consumer, minIdleMillis, ids, options, array(streamId), true);

const AutoOptions = Schema.Struct({ count: Schema.optionalKey(Positive) });
export type AutoClaimOptions = typeof AutoOptions.Type;

const claimPage =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<ClaimPage<A>> =>
  (reply) =>
    Effect.gen(function* () {
      const values = yield* elements(reply, 2, 3);
      return {
        cursor: yield* at(values, 0, streamId),
        entries: yield* at(values, 1, array(decode)),
        deleted:
          values.length === 2 ? Option.none() : Option.some(yield* at(values, 2, array(streamId))),
      };
    });

const autoClaim = <A>(
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  start: StreamPosition,
  options: AutoClaimOptions,
  decode: ReplyDecoder<A>,
  justId: boolean,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(AutoOptions, options);
      return yield* keyed(
        catalog.XAUTOCLAIM,
        key,
        Effect.gen(function* () {
          return [
            yield* parse(Argument, group),
            yield* parse(Argument, consumer),
            String(yield* parse(NonNegative, minIdleMillis)),
            yield* parse(StreamPosition, start),
            ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
            ...(justId ? ["JUSTID"] : []),
          ];
        }),
        claimPage(decode),
        "read-write",
      ).prepare;
    }),
  );

export const xautoclaim = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  start: StreamPosition = "0-0",
  options: AutoClaimOptions = {},
) => autoClaim(key, group, consumer, minIdleMillis, start, options, nullable(groupEntry), false);

export const xautoclaimIds = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
  minIdleMillis: Integer,
  start: StreamPosition = "0-0",
  options: AutoClaimOptions = {},
) => autoClaim(key, group, consumer, minIdleMillis, start, options, streamId, true);
