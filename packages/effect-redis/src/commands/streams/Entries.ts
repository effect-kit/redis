import { Effect, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { unsigned } from "#/command/reply/Data";
import { optional, status } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { Argument, Pairs, parse, Positive } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { AddId, streamId, StreamBound } from "#/commands/streams/Id";
import { entry } from "#/commands/streams/reply/Entries";
import { ReferencePolicy, Trim, trimTokens } from "#/commands/streams/Trim";
import type { RedisArgument } from "#/RedisArgument";

const AddOptions = Schema.Struct({
  trim: Schema.optionalKey(Trim),
  references: Schema.optionalKey(ReferencePolicy),
  idempotency: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ mode: Schema.Literal("IDMPAUTO"), producer: Argument }),
      Schema.Struct({ mode: Schema.Literal("IDMP"), producer: Argument, id: Argument }),
    ]),
  ),
});
export type StreamAddOptions = typeof AddOptions.Type;
export type StreamFieldInput = readonly [
  readonly [RedisArgument, RedisArgument],
  ...Array<readonly [RedisArgument, RedisArgument]>,
];

const addTail = Effect.fnUntraced(function* (
  id: AddId,
  fields: StreamFieldInput,
  options: StreamAddOptions,
  existing: boolean,
) {
  const selected = yield* parse(AddOptions, options);
  const token = yield* parse(AddId, id);
  const values = yield* parse(Pairs, fields);
  const idmp = selected.idempotency;
  return [
    ...(existing ? ["NOMKSTREAM"] : []),
    ...(selected.references === undefined ? [] : [selected.references]),
    ...(idmp === undefined
      ? []
      : [idmp.mode, idmp.producer, ...(idmp.mode === "IDMP" ? [idmp.id] : [])]),
    ...(selected.trim === undefined ? [] : yield* trimTokens(selected.trim)),
    token,
    ...values.flat(),
  ];
});

export const xadd = (
  key: RedisArgument,
  id: AddId,
  fields: StreamFieldInput,
  options: StreamAddOptions = {},
) => keyed(catalog.XADD, key, addTail(id, fields, options, false), streamId, "read-write");

export const xaddIfExists = (
  key: RedisArgument,
  id: AddId,
  fields: StreamFieldInput,
  options: StreamAddOptions = {},
) => keyed(catalog.XADD, key, addTail(id, fields, options, true), optional(streamId), "read-write");

const RangeOptions = Schema.Struct({ count: Schema.optionalKey(Positive) });
export type StreamRangeOptions = typeof RangeOptions.Type;

const range = (
  name: "XRANGE" | "XREVRANGE",
  key: RedisArgument,
  first: StreamBound,
  last: StreamBound,
  options: StreamRangeOptions,
) =>
  keyed(
    catalog[name],
    key,
    Effect.gen(function* () {
      const selected = yield* parse(RangeOptions, options);
      return [
        yield* parse(StreamBound, first),
        yield* parse(StreamBound, last),
        ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
      ];
    }),
    array(entry),
  );

export const xrange = (
  key: RedisArgument,
  start: StreamBound = "-",
  end: StreamBound = "+",
  options: StreamRangeOptions = {},
) => range("XRANGE", key, start, end, options);

export const xrevrange = (
  key: RedisArgument,
  end: StreamBound = "+",
  start: StreamBound = "-",
  options: StreamRangeOptions = {},
) => range("XREVRANGE", key, end, start, options);

export const xlen = (key: RedisArgument) => keyed(catalog.XLEN, key, Effect.succeed([]), unsigned);

const ConfigOptions = Schema.Struct({
  idmpDurationSeconds: Schema.optionalKey(Positive),
  idmpMaxSize: Schema.optionalKey(Positive),
});
export type StreamConfigOptions = typeof ConfigOptions.Type;

export const xcfgset = (key: RedisArgument, options: StreamConfigOptions) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(ConfigOptions, options);
      if (selected.idmpDurationSeconds === undefined && selected.idmpMaxSize === undefined)
        return yield* parse(Schema.Never, options);
      const args: ReadonlyArray<RedisArgument> = [
        ...(selected.idmpDurationSeconds === undefined
          ? []
          : ["IDMP-DURATION", String(selected.idmpDurationSeconds)]),
        ...(selected.idmpMaxSize === undefined
          ? []
          : ["IDMP-MAXSIZE", String(selected.idmpMaxSize)]),
      ];
      return yield* keyed(catalog.XCFGSET, key, Effect.succeed(args), status("OK"), "read-write")
        .prepare;
    }),
  );
