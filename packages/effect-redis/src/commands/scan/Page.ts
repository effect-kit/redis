import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { tuple } from "#/command/reply/Data";
import { mismatch, text } from "#/command/reply/Scalars";

/** Decimal uint64 token; cursor arithmetic has no meaning for hash-table scans. */
export const Cursor = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]{0,19})$/),
  Schema.makeFilter(
    (value) => /^[0-9]{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n,
  ),
);

export interface ScanPage<A> {
  readonly cursor: string;
  readonly entries: ReadonlyArray<A>;
}

export const page =
  <A>(decode: ReplyDecoder<ReadonlyArray<A>>): ReplyDecoder<ScanPage<A>> =>
  (reply) =>
    tuple(
      text,
      decode,
    )(reply).pipe(
      Effect.flatMap(([cursor, entries]) =>
        Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
          Effect.map(() => ({ cursor, entries })),
          Effect.mapError(() => mismatch("custom", reply)),
        ),
      ),
    );
