import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import type { CommandMetadata } from "#/command/Metadata";
import { keyed, ordinary } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export type ModuleFamily = "json" | "search" | "timeseries" | "probabilistic" | "vectorset";

const sources = {
  json: ["https://github.com/RedisJSON/RedisJSON", "v8.10.0"],
  search: ["https://github.com/RediSearch/RediSearch", "v8.10.1"],
  timeseries: ["https://github.com/RedisTimeSeries/RedisTimeSeries", "v8.10.1"],
  probabilistic: ["https://github.com/RedisBloom/RedisBloom", "v8.10.1"],
  vectorset: ["https://github.com/redis/redis/tree/8.10.2/modules/vector-sets", "8.10.2"],
} as const;

/** Module versions are independent of the server's compatibility banner. Availability is not a preflight gate. */
export const moduleMetadata = (family: ModuleFamily, name: string): CommandMetadata => ({
  name,
  family,
  execution: "ordinary",
  replay: "never",
  scenarios: name.endsWith(".SCANDUMP") ? ["MODULE", "MODULE-DUMP"] : ["MODULE"],
  provenance: [
    { source: sources[family][0], revision: sources[family][1] },
    ...(name.startsWith("BF.")
      ? [{ source: "https://github.com/valkey-io/valkey-bloom", revision: "1.0.1" }]
      : []),
  ],
  availability: [`Requires the ${family} command surface; reviewed source ${sources[family][1]}`],
});

export const moduleKeyed = <A>(
  family: ModuleFamily,
  name: string,
  key: RedisArgument,
  decode: ReplyDecoder<A>,
  args: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
  access: "read" | "write" | "read-write" = "read",
) => keyed(moduleMetadata(family, name), key, args, decode, access);

export const Probability = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
  Schema.isLessThan(1),
);
export const probability = (value: number) => parse(Probability, value).pipe(Effect.map(String));

/** Label/index queries select server-owned state. Cluster execution requires an explicit node. */
export const moduleKeyless = <A>(
  family: ModuleFamily,
  name: string,
  decode: ReplyDecoder<A>,
  args: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError> = Effect.succeed([]),
) =>
  ordinary(
    moduleMetadata(family, name),
    decode,
    args.pipe(
      Effect.map((tail) => {
        const [command = "", ...subcommands] = name.split(" ");
        return {
          tokens: [command, ...subcommands, ...tail] as const,
          routing: { _tag: "Keyless" as const },
        };
      }),
    ),
  );
