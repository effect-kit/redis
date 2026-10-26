import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { ordinary } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export const Name = Schema.NonEmptyString;
export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
export const names = (values: ReadonlyArray<string>) => parse(Schema.NonEmptyArray(Name), values);
export const name = (value: string) =>
  parse(Name, value).pipe(Effect.map((selected) => [selected]));

/** These descriptors belong to an explicit Sentinel endpoint, never a discovered data node. */
export const sentinelCommand = <A>(
  subcommand: string,
  decode: ReplyDecoder<A>,
  args: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
) =>
  ordinary(
    {
      ...metadata(
        `SENTINEL ${subcommand}`,
        "sentinel",
        ["SENTINEL"],
        ["GET-PRIMARY-ADDR-BY-NAME", "PRIMARY", "PRIMARIES", "IS-PRIMARY-DOWN-BY-ADDR"].includes(
          subcommand,
        )
          ? ["Valkey 8.0+ alias; not available in the pinned Redis baseline"]
          : subcommand === "FAILOVER"
            ? ["COORDINATED requires Valkey 9.0+"]
            : [],
      ),
      execution: "exclusive",
    },
    decode,
    args.pipe(
      Effect.map((tail) => ({
        tokens: ["SENTINEL", ...subcommand.split(" "), ...tail],
        routing: { _tag: "Keyless" },
      })),
    ),
  );
