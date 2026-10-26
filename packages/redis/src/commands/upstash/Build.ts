import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { defineCommand, fromPreparation } from "#/command/Command";
import type { CommandMetadata } from "#/command/Metadata";
import { parse } from "#/commands/internal/Input";
import type { CommandInputError } from "#/errors/CommandInputError";
import type { RedisArgument } from "#/RedisArgument";

export const Name = Schema.Union([
  Schema.NonEmptyString,
  Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length > 0)),
]);

export const metadata = (name: string): CommandMetadata => {
  const family = name.startsWith("SEARCH.")
    ? "search"
    : name.startsWith("VECTOR.")
      ? "vector"
      : "acl";
  const page = name.toLowerCase().replaceAll(".", "-").replaceAll(" ", "-");

  return {
    name,
    family: `upstash-${family}`,
    execution: "ordinary",
    replay: "never",
    scenarios: ["UPSTASH-EXTENSION"],
    provenance: [
      {
        source: `https://upstash.com/docs/redis/commands/${family === "acl" ? "server" : family}/${page}`,
        revision: "reviewed-2026-10-26",
      },
    ],
    availability: ["Upstash Redis extension; actual enabled service build determines availability"],
  };
};

export const command = <A, E = never, R = never>(
  name: string,
  decode: ReplyDecoder<A, E, R>,
  args: Effect.Effect<ReadonlyArray<RedisArgument>, CommandInputError>,
) =>
  fromPreparation(
    args.pipe(
      Effect.flatMap(
        (tail) =>
          defineCommand({
            metadata: metadata(name),
            decode,
            tokens: [name.split(" ")[0] ?? "", ...name.split(" ").slice(1), ...tail] as const,
            // Search indexes/aliases are a provider-owned namespace; no client Cluster routing is inferred.
            routing: name.startsWith("VECTOR.")
              ? {
                  _tag: "Keys" as const,
                  keys: [
                    {
                      index: 1,
                      access:
                        name === "VECTOR.GET" ||
                        name === "VECTOR.QUERY" ||
                        name === "VECTOR.INFO" ||
                        name === "VECTOR.COUNT"
                          ? ("read" as const)
                          : ("read-write" as const),
                    },
                  ] as const,
                }
              : { _tag: "Keyless" as const },
          }).prepare,
      ),
    ),
  );

export const named = <A, E = never, R = never>(
  name: string,
  key: RedisArgument,
  decode: ReplyDecoder<A, E, R>,
) => command(name, decode, parse(Name, key).pipe(Effect.map((value) => [value])));
