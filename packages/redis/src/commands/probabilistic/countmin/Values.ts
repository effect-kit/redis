import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { unsigned, withLength } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { Argument, Arguments, NonNegative, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { moduleKeyed, moduleMetadata, Probability } from "#/commands/modules/Build";
import type { RedisArgument } from "#/RedisArgument";

export const cmsInitbydim = (key: RedisArgument, width: Integer, depth: Integer) =>
  moduleKeyed(
    "probabilistic",
    "CMS.INITBYDIM",
    key,
    status("OK"),
    parse(Schema.Tuple([Positive, Positive]), [width, depth]).pipe(
      Effect.map((values) => values.map(String)),
    ),
    "write",
  );

export const cmsInitbyprob = (key: RedisArgument, error: number, probability: number) =>
  moduleKeyed(
    "probabilistic",
    "CMS.INITBYPROB",
    key,
    status("OK"),
    parse(Schema.Tuple([Probability, Probability]), [error, probability]).pipe(
      Effect.map((values) => values.map(String)),
    ),
    "write",
  );

export const cmsInfo = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "CMS.INFO", key, fields);

export const cmsQuery = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  keyedVector(
    moduleMetadata("probabilistic", "CMS.QUERY"),
    key,
    parse(Arguments, values),
    array(unsigned),
  );

export const cmsIncrby = (
  key: RedisArgument,
  entries: readonly [
    readonly [RedisArgument, Integer],
    ...Array<readonly [RedisArgument, Integer]>,
  ],
) => ({
  prepare: Effect.gen(function* () {
    const selected = yield* parse(
      Schema.NonEmptyArray(Schema.Tuple([Argument, NonNegative])),
      entries,
    );

    return yield* moduleKeyed(
      "probabilistic",
      "CMS.INCRBY",
      key,
      withLength(selected.length, array(unsigned)),
      Effect.succeed(selected.flatMap(([value, increment]) => [value, String(increment)])),
      "read-write",
    ).prepare;
  }),
});
