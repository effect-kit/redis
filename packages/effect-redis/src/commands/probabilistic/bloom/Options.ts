import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned, withLength } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { Arguments, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed, Probability } from "#/commands/modules/Build";
import { moduleBoolean as boolean } from "#/commands/modules/Reply";
import { bloomInfoField } from "#/commands/probabilistic/bloom/InfoReply";
import type { RedisArgument } from "#/RedisArgument";

const Scaling = Schema.Struct({
  expansion: Schema.optionalKey(Positive),
  nonScaling: Schema.optionalKey(Schema.Boolean),
});
const Insert = Schema.Struct({
  ...Scaling.fields,
  capacity: Schema.optionalKey(Positive),
  errorRate: Schema.optionalKey(Probability),
  noCreate: Schema.optionalKey(Schema.Boolean),
});
export interface BloomScaling {
  readonly expansion?: Integer;
  readonly nonScaling?: boolean;
}
export interface BloomInsertOptions extends BloomScaling {
  readonly capacity?: Integer;
  readonly errorRate?: number;
  readonly noCreate?: boolean;
}

const scaling = Effect.fnUntraced(function* (options: BloomScaling) {
  const selected = yield* parse(Scaling, options);
  if (selected.nonScaling && selected.expansion !== undefined)
    return yield* parse(Schema.Never, selected);
  return [
    ...(selected.expansion === undefined ? [] : ["EXPANSION", String(selected.expansion)]),
    ...(selected.nonScaling ? ["NONSCALING"] : []),
  ];
});

export const bfReserve = (
  key: RedisArgument,
  errorRate: number,
  capacity: Integer,
  options: BloomScaling = {},
) =>
  moduleKeyed(
    "probabilistic",
    "BF.RESERVE",
    key,
    status("OK"),
    Effect.gen(function* () {
      const [error, size] = yield* parse(Schema.Tuple([Probability, Positive]), [
        errorRate,
        capacity,
      ]);
      return [String(error), String(size), ...(yield* scaling(options))];
    }),
    "write",
  );

export const bfInsert = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
  options: BloomInsertOptions = {},
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(Insert, options);
    const entries = yield* parse(Arguments, values);
    const flags = yield* scaling({
      ...(selected.expansion === undefined ? {} : { expansion: selected.expansion }),
      ...(selected.nonScaling === undefined ? {} : { nonScaling: selected.nonScaling }),
    });
    return yield* moduleKeyed(
      "probabilistic",
      "BF.INSERT",
      key,
      withLength(entries.length, array(boolean)),
      Effect.succeed([
        ...(selected.capacity === undefined ? [] : ["CAPACITY", String(selected.capacity)]),
        ...(selected.errorRate === undefined ? [] : ["ERROR", String(selected.errorRate)]),
        ...flags,
        ...(selected.noCreate ? ["NOCREATE"] : []),
        "ITEMS",
        ...entries,
      ]),
      "read-write",
    ).prepare;
  }),
});

export const bfCard = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "BF.CARD", key, unsigned);
export const bfInfoValue = (key: RedisArgument, field: "CAPACITY" | "SIZE" | "FILTERS" | "ITEMS") =>
  moduleKeyed(
    "probabilistic",
    "BF.INFO",
    key,
    bloomInfoField(
      {
        CAPACITY: "Capacity",
        SIZE: "Size",
        FILTERS: "Number of filters",
        ITEMS: "Number of items inserted",
      }[field],
      unsigned,
    ),
    parse(Schema.Literals(["CAPACITY", "SIZE", "FILTERS", "ITEMS"]), field).pipe(
      Effect.map((value) => [value]),
    ),
  );
