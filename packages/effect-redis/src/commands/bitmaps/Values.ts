import { Effect, Schema } from "effect";

import { boolean } from "#/command/reply/Data";
import { integer } from "#/command/reply/Scalars";
import { catalog } from "#/commands/bitmaps/Catalog";
import { keyed, ordinary } from "#/commands/internal/Command";
import { Arguments, Integer, nonNegative, parse } from "#/commands/internal/Input";
import { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

const bit = (reply: Parameters<typeof boolean>[0]) =>
  boolean(reply).pipe(Effect.map((value): 0 | 1 => (value ? 1 : 0)));

export const getbit = (key: RedisArgument, offset: Integer) =>
  keyed(catalog.GETBIT, key, nonNegative(offset).pipe(Effect.map((n) => [n])), bit);

export const setbit = (key: RedisArgument, offset: Integer, value: 0 | 1) =>
  keyed(
    catalog.SETBIT,
    key,
    Effect.gen(function* () {
      return [yield* nonNegative(offset), String(yield* parse(Schema.Literals([0, 1]), value))];
    }),
    bit,
    "read-write",
  );

const CountRange = Schema.Struct({
  start: Integer,
  end: Integer,
  unit: Schema.optionalKey(Schema.Literals(["BYTE", "BIT"])),
});
export type BitRange = typeof CountRange.Type;

export const bitcount = (key: RedisArgument, range?: BitRange) =>
  keyed(
    catalog.BITCOUNT,
    key,
    range === undefined
      ? Effect.succeed([])
      : parse(CountRange, range).pipe(
          Effect.map((r) => [
            String(r.start),
            String(r.end),
            ...(r.unit === undefined ? [] : [r.unit]),
          ]),
        ),
    integer,
  );

const PositionRange = Schema.Struct({
  start: Integer,
  end: Schema.optionalKey(Integer),
  unit: Schema.optionalKey(Schema.Literals(["BYTE", "BIT"])),
});
export type BitPositionRange = typeof PositionRange.Type;

export const bitpos = (key: RedisArgument, value: 0 | 1, range?: BitPositionRange) =>
  keyed(
    catalog.BITPOS,
    key,
    Effect.gen(function* () {
      const selected = yield* parse(Schema.Literals([0, 1]), value);
      if (range === undefined) return [String(selected)];
      const r = yield* parse(PositionRange, range);
      if (r.unit !== undefined && r.end === undefined)
        return yield* new CommandInputError({ delivery: "unsent", reason: "options" });
      return [
        String(selected),
        String(r.start),
        ...(r.end === undefined ? [] : [String(r.end)]),
        ...(r.unit === undefined ? [] : [r.unit]),
      ];
    }),
    integer,
  );

const Operation = Schema.Literals(["AND", "OR", "XOR", "NOT", "DIFF", "DIFF1", "ANDOR", "ONE"]);
export type BitOperation = typeof Operation.Type;

export const bitop = (
  operation: BitOperation,
  destination: RedisArgument,
  sources: readonly [RedisArgument, ...RedisArgument[]],
) =>
  ordinary(
    catalog.BITOP,
    integer,
    Effect.gen(function* () {
      const mode = yield* parse(Operation, operation);
      const keys = yield* parse(Arguments, sources);
      if (mode === "NOT" && keys.length !== 1)
        return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });
      return {
        tokens: ["BITOP", mode, destination, ...keys],
        routing: {
          _tag: "Keys",
          keys: [
            { index: 2, access: "write" },
            ...keys.map((_, index) => ({ index: index + 3, access: "read" as const })),
          ],
        },
      };
    }),
  );
