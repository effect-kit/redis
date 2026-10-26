import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { pairs, unsigned, withLength } from "#/command/reply/Data";
import { blob, optional, status } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Argument, Arguments, Finite, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { moduleBoolean as boolean } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const topkReserve = (
  key: RedisArgument,
  count: Integer,
  sketch?: { readonly width: Integer; readonly depth: Integer; readonly decay: number },
) =>
  moduleKeyed(
    "probabilistic",
    "TOPK.RESERVE",
    key,
    status("OK"),
    Effect.gen(function* () {
      const size = yield* parse(Positive, count);
      const selected = yield* parse(
        Schema.UndefinedOr(
          Schema.Struct({
            width: Positive,
            depth: Positive,
            decay: Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1)),
          }),
        ),
        sketch,
      );
      return [
        String(size),
        ...(selected === undefined
          ? []
          : [String(selected.width), String(selected.depth), String(selected.decay)]),
      ];
    }),
    "write",
  );

export const topkAdd = (key: RedisArgument, values: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "TOPK.ADD"),
    key,
    parse(Arguments, values),
    array(optional(blob)),
    { access: "read-write" },
  );
export const topkQuery = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  keyedVector(
    moduleMetadata("probabilistic", "TOPK.QUERY"),
    key,
    parse(Arguments, values),
    array(boolean),
  );
export const topkCount = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  keyedVector(
    moduleMetadata("probabilistic", "TOPK.COUNT"),
    key,
    parse(Arguments, values),
    array(unsigned),
  );
export const topkList = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "TOPK.LIST", key, array(blob));
export const topkListWithCount = (key: RedisArgument) =>
  moduleKeyed(
    "probabilistic",
    "TOPK.LIST",
    key,
    pairs(blob, unsigned),
    Effect.succeed(["WITHCOUNT"]),
  );
export const topkInfo = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "TOPK.INFO", key, fields);

export const topkIncrby = (
  key: RedisArgument,
  entries: readonly [
    readonly [RedisArgument, Integer],
    ...Array<readonly [RedisArgument, Integer]>,
  ],
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(
      Schema.NonEmptyArray(Schema.Tuple([Argument, Positive])),
      entries,
    );
    return yield* moduleKeyed(
      "probabilistic",
      "TOPK.INCRBY",
      key,
      withLength(selected.length, array(optional(blob))),
      Effect.succeed(selected.flatMap(([value, increment]) => [value, String(increment)])),
      "read-write",
    ).prepare;
  }),
});
