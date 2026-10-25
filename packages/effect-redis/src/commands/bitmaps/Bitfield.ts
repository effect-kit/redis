import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { integer, optional } from "#/command/reply/Scalars";
import { catalog } from "#/commands/bitmaps/Catalog";
import { keyed } from "#/commands/internal/Command";
import { Integer, NonNegative, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

const Signed = Schema.Struct({
  signed: Schema.Literal(true),
  bits: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
});
const Unsigned = Schema.Struct({
  signed: Schema.Literal(false),
  bits: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 63 })),
});
const Encoding = Schema.Union([Signed, Unsigned]);
const Offset = Schema.Union([NonNegative, Schema.Struct({ index: NonNegative })]);
const Read = Schema.Struct({
  operation: Schema.Literal("GET"),
  encoding: Encoding,
  offset: Offset,
});
const Write = Schema.Struct({
  operation: Schema.Literals(["SET", "INCRBY"]),
  encoding: Encoding,
  offset: Offset,
  value: Integer,
  overflow: Schema.optionalKey(Schema.Literals(["WRAP", "SAT", "FAIL"])),
});

export type BitfieldRead = typeof Read.Type;
export type BitfieldOperation = typeof Read.Type | typeof Write.Type;

const encode = (operations: ReadonlyArray<BitfieldOperation>, readOnly: boolean) =>
  Effect.gen(function* () {
    const parsed = yield* parse(
      Schema.Array(readOnly ? Read : Schema.Union([Read, Write])),
      operations,
    );
    const tokens: RedisArgument[] = [];
    for (const operation of parsed) {
      // Redis retains overflow mode for following writes until another OVERFLOW token.
      if ("overflow" in operation && operation.overflow !== undefined)
        tokens.push("OVERFLOW", operation.overflow);
      const width = `${operation.encoding.signed ? "i" : "u"}${operation.encoding.bits}`;
      const offset =
        typeof operation.offset === "object"
          ? `#${operation.offset.index}`
          : String(operation.offset);
      tokens.push(operation.operation, width, offset);
      if ("value" in operation) tokens.push(String(operation.value));
    }
    return tokens;
  });

export const bitfield = (key: RedisArgument, operations: ReadonlyArray<BitfieldOperation>) =>
  keyed(catalog.BITFIELD, key, encode(operations, false), array(optional(integer)), "read-write");

export const bitfieldRo = (key: RedisArgument, operations: ReadonlyArray<BitfieldRead>) =>
  keyed(catalog.BITFIELD_RO, key, encode(operations, true), array(integer));
