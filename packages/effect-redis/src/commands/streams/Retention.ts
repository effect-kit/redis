import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { unsigned, withLength } from "#/command/reply/Data";
import { integer, mismatch } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { Argument, parse, NonNegative } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { StreamId } from "#/commands/streams/Id";
import { ReferencePolicy, trimTokens } from "#/commands/streams/Trim";
import type { StreamTrim } from "#/commands/streams/Trim";
import type { RedisArgument } from "#/RedisArgument";

export type StreamIds = readonly [StreamId, ...StreamId[]];
const Ids = Schema.NonEmptyArray(StreamId);

export const xdel = (key: RedisArgument, ids: StreamIds) =>
  keyed(catalog.XDEL, key, parse(Ids, ids), unsigned, "read-write");

export const xack = (key: RedisArgument, group: RedisArgument, ids: StreamIds) =>
  keyed(
    catalog.XACK,
    key,
    Effect.gen(function* () {
      return [yield* parse(Argument, group), ...(yield* parse(Ids, ids))];
    }),
    unsigned,
    "read-write",
  );

export const xtrim = (key: RedisArgument, trim: StreamTrim, references?: ReferencePolicy) =>
  keyed(
    catalog.XTRIM,
    key,
    Effect.gen(function* () {
      return [
        ...(yield* trimTokens(trim)),
        ...(references === undefined ? [] : [yield* parse(ReferencePolicy, references)]),
      ];
    }),
    unsigned,
    "read-write",
  );

const deletionResult: ReplyDecoder<-1n | 1n | 2n> = (reply) =>
  integer(reply).pipe(
    Effect.flatMap((value) =>
      value === -1n || value === 1n || value === 2n
        ? Effect.succeed(value)
        : Effect.fail(mismatch("custom", reply)),
    ),
  );

const remove = (
  name: "XACKDEL" | "XDELEX",
  key: RedisArgument,
  ids: StreamIds,
  references?: ReferencePolicy,
  group?: RedisArgument,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const tokens = yield* parse(Ids, ids);
      const policy = references === undefined ? [] : [yield* parse(ReferencePolicy, references)];
      const prefix = group === undefined ? [] : [yield* parse(Argument, group)];
      return yield* keyed(
        catalog[name],
        key,
        Effect.succeed([...prefix, ...policy, "IDS", String(tokens.length), ...tokens]),
        withLength(tokens.length, array(deletionResult)),
        "read-write",
      ).prepare;
    }),
  );

export const xackdel = (
  key: RedisArgument,
  group: RedisArgument,
  ids: StreamIds,
  references?: ReferencePolicy,
) => remove("XACKDEL", key, ids, references, group);

export const xdelex = (key: RedisArgument, ids: StreamIds, references?: ReferencePolicy) =>
  remove("XDELEX", key, ids, references);

const NackOptions = Schema.Struct({
  retryCount: Schema.optionalKey(NonNegative),
  force: Schema.optionalKey(Schema.Boolean),
});
export type StreamNackOptions = typeof NackOptions.Type;

export const xnack = (
  key: RedisArgument,
  group: RedisArgument,
  mode: "SILENT" | "FAIL" | "FATAL",
  ids: StreamIds,
  options: StreamNackOptions = {},
) =>
  keyed(
    catalog.XNACK,
    key,
    Effect.gen(function* () {
      const selected = yield* parse(NackOptions, options);
      const values = yield* parse(Ids, ids);
      return [
        yield* parse(Argument, group),
        yield* parse(Schema.Literals(["SILENT", "FAIL", "FATAL"]), mode),
        "IDS",
        String(values.length),
        ...values,
        ...(selected.retryCount === undefined ? [] : ["RETRYCOUNT", String(selected.retryCount)]),
        ...(selected.force ? ["FORCE"] : []),
      ];
    }),
    unsigned,
    "read-write",
  );
