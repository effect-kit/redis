import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, unsigned } from "#/command/reply/Data";
import { blob, integer } from "#/command/reply/Scalars";
import {
  Arguments,
  Integer as InputInteger,
  integer as encodeInteger,
  parse,
} from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { legacy, matching, MatchPath } from "#/commands/json/Path";
import type { JsonPath } from "#/commands/json/Path";
import { moduleKeyed } from "#/commands/modules/Build";
import { losslessValue } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

type JsonArguments = readonly [RedisArgument, ...RedisArgument[]];

export const jsonArrlen = (key: RedisArgument, path: JsonPath = "$") =>
  matching("JSON.ARRLEN", key, path, unsigned);
export const jsonArrlenLegacy = (key: RedisArgument, path = ".") =>
  legacy("JSON.ARRLEN", key, path, unsigned);
export const jsonArrappend = (key: RedisArgument, path: JsonPath, values: JsonArguments) =>
  matching("JSON.ARRAPPEND", key, path, unsigned, parse(Arguments, values), "read-write");
export const jsonArrappendLegacy = (key: RedisArgument, path: string, values: JsonArguments) =>
  legacy("JSON.ARRAPPEND", key, path, unsigned, parse(Arguments, values), "read-write");
export const jsonArrinsert = (
  key: RedisArgument,
  path: JsonPath,
  index: Integer,
  values: JsonArguments,
) =>
  matching(
    "JSON.ARRINSERT",
    key,
    path,
    unsigned,
    Effect.all([encodeInteger(index), parse(Arguments, values)]).pipe(
      Effect.map(([position, entries]) => [position, ...entries]),
    ),
    "read-write",
  );
export const jsonArrinsertLegacy = (
  key: RedisArgument,
  path: string,
  index: Integer,
  values: JsonArguments,
) =>
  legacy(
    "JSON.ARRINSERT",
    key,
    path,
    unsigned,
    Effect.all([encodeInteger(index), parse(Arguments, values)]).pipe(
      Effect.map(([position, entries]) => [position, ...entries]),
    ),
    "read-write",
  );
export const jsonArrtrim = (key: RedisArgument, path: JsonPath, start: Integer, stop: Integer) =>
  matching(
    "JSON.ARRTRIM",
    key,
    path,
    unsigned,
    Effect.all([encodeInteger(start), encodeInteger(stop)]),
    "read-write",
  );
export const jsonArrtrimLegacy = (
  key: RedisArgument,
  path: string,
  start: Integer,
  stop: Integer,
) =>
  legacy(
    "JSON.ARRTRIM",
    key,
    path,
    unsigned,
    Effect.all([encodeInteger(start), encodeInteger(stop)]),
    "read-write",
  );

const bounds = Effect.fnUntraced(function* (options: {
  readonly start?: Integer;
  readonly stop?: Integer;
}) {
  const selected = yield* parse(
    Schema.Struct({
      start: Schema.optionalKey(InputInteger),
      stop: Schema.optionalKey(InputInteger),
    }),
    options,
  );
  if (selected.stop !== undefined && selected.start === undefined)
    return yield* parse(Schema.Never, options);
  return [
    ...(selected.start === undefined ? [] : [String(selected.start)]),
    ...(selected.stop === undefined ? [] : [String(selected.stop)]),
  ];
});
export const jsonArrindex = (
  key: RedisArgument,
  path: JsonPath,
  value: RedisArgument,
  options: { readonly start?: Integer; readonly stop?: Integer } = {},
) =>
  matching(
    "JSON.ARRINDEX",
    key,
    path,
    integer,
    bounds(options).pipe(Effect.map((range) => [value, ...range])),
  );
export const jsonArrindexLegacy = (
  key: RedisArgument,
  path: string,
  value: RedisArgument,
  options: { readonly start?: Integer; readonly stop?: Integer } = {},
) =>
  legacy(
    "JSON.ARRINDEX",
    key,
    path,
    integer,
    bounds(options).pipe(Effect.map((range) => [value, ...range])),
  );

/** Each popped match remains serialized JSON; a popped JSON null is bytes, not absence. */
export const jsonArrpop = (key: RedisArgument, path: JsonPath = "$", index: Integer = -1) =>
  matching(
    "JSON.ARRPOP",
    key,
    path,
    blob,
    encodeInteger(index).pipe(Effect.map((position) => [position])),
    "read-write",
  );
export const jsonArrpopLegacy = (key: RedisArgument, path = ".", index: Integer = -1) =>
  legacy(
    "JSON.ARRPOP",
    key,
    path,
    blob,
    encodeInteger(index).pipe(Effect.map((position) => [position])),
    "read-write",
  );
export const jsonArrpopExpanded = (key: RedisArgument, path: JsonPath = "$", index: Integer = -1) =>
  moduleKeyed(
    "json",
    "JSON.ARRPOP",
    key,
    nullable(array(losslessValue)),
    Effect.all([parse(MatchPath, path), encodeInteger(index)]).pipe(
      Effect.map(([selected, position]) => ["FORMAT", "EXPAND", selected, position]),
    ),
    "read-write",
  );
