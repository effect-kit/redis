import { Effect, Option, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { pairs, unsigned } from "#/command/reply/Data";
import { mismatch, text } from "#/command/reply/Scalars";
import { score } from "#/command/reply/Score";
import { catalog } from "#/commands/arrays/Catalog";
import { keyed } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export interface ArrayInfoDetails {
  readonly denseSlices: bigint;
  readonly sparseSlices: bigint;
  readonly averageDenseSize: number;
  readonly averageDenseFill: number;
  readonly averageSparseSize: number;
}
export interface ArrayInfo {
  readonly count: bigint;
  readonly length: bigint;
  readonly nextInsertIndex: bigint;
  readonly slices: bigint;
  readonly directorySize: bigint;
  readonly superDirectoryEntries: bigint;
  readonly sliceSize: bigint;
  readonly details: Option.Option<ArrayInfoDetails>;
}

const info =
  (full: boolean): ReplyDecoder<ArrayInfo> =>
  (reply) =>
    Effect.gen(function* () {
      const entries = yield* pairs(text, (value) => Effect.succeed(value))(reply);
      const read = <A>(name: string, decode: ReplyDecoder<A>) => {
        const value = entries.find(([key]) => key === name)?.[1];
        return value === undefined ? Effect.fail(mismatch("custom", reply)) : decode(value);
      };

      return {
        count: yield* read("count", unsigned),
        length: yield* read("len", unsigned),
        nextInsertIndex: yield* read("next-insert-index", unsigned),
        slices: yield* read("slices", unsigned),
        directorySize: yield* read("directory-size", unsigned),
        superDirectoryEntries: yield* read("super-dir-entries", unsigned),
        sliceSize: yield* read("slice-size", unsigned),
        details: full
          ? Option.some({
              denseSlices: yield* read("dense-slices", unsigned),
              sparseSlices: yield* read("sparse-slices", unsigned),
              averageDenseSize: yield* read("avg-dense-size", score),
              averageDenseFill: yield* read("avg-dense-fill", score),
              averageSparseSize: yield* read("avg-sparse-size", score),
            })
          : Option.none(),
      };
    });

export const arinfo = (key: RedisArgument, full = false) =>
  keyed(
    catalog.ARINFO,
    key,
    parse(Schema.Boolean, full).pipe(Effect.map((value) => (value ? ["FULL"] : []))),
    info(full),
  );
