import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { keyIndexes, ordinary } from "#/commands/internal/Command";
import { Argument, parse, Positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import { Cursor, page } from "#/commands/scan/Page";
import type { RedisArgument } from "#/RedisArgument";

export interface ScanOptions {
  readonly match?: RedisArgument;
  readonly count?: Integer;
}

export interface KeyScanOptions extends ScanOptions {
  readonly type?: RedisArgument;
}

const Options = Schema.Struct({
  match: Schema.optionalKey(Argument),
  count: Schema.optionalKey(Positive),
  type: Schema.optionalKey(Argument),
});

export const scanCommand = <A>(
  name: "SCAN" | "HSCAN" | "SSCAN" | "ZSCAN",
  cursor: string,
  options: KeyScanOptions,
  decode: ReplyDecoder<ReadonlyArray<A>>,
  key?: RedisArgument,
  flag?: "NOVALUES" | "NOSCORES",
) =>
  ordinary(
    metadata(
      name,
      { SCAN: "keys", HSCAN: "hashes", SSCAN: "sets", ZSCAN: "sorted-sets" }[name],
      ["SCAN"],
      [
        "Redis/Valkey since 2.8.0",
        ...(flag === "NOVALUES"
          ? ["NOVALUES verified: Redis 7.4.6/8.10.2; Valkey 8.0.3/9.1.2"]
          : []),
        ...(flag === "NOSCORES"
          ? ["NOSCORES verified: Valkey 8.0.3/9.1.2; absent from Redis 8.10.2 source baseline"]
          : []),
      ],
    ),
    page(decode),
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      const token = yield* parse(Cursor, cursor);
      if (name !== "SCAN" && selected.type !== undefined)
        return yield* parse(Schema.Never, selected.type);

      return {
        tokens: [
          name,
          ...(key === undefined ? [] : [key]),
          token,
          ...(selected.match === undefined ? [] : ["MATCH", selected.match]),
          ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
          ...(selected.type === undefined ? [] : ["TYPE", selected.type]),
          ...(flag === undefined ? [] : [flag]),
        ],
        routing: keyIndexes(key === undefined ? [] : [1], "read"),
      };
    }),
  );
