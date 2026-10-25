import { Effect, Schema } from "effect";

import { unsigned } from "#/command/reply/Data";
import { ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

const publication = (name: "PUBLISH" | "SPUBLISH", channel: RedisArgument, value: RedisArgument) =>
  ordinary(
    metadata(name, "pubsub", ["PUSH"], [name === "PUBLISH" ? "Since 2.0.0" : "Since 7.0.0"]),
    unsigned,
    parse(Schema.Tuple([Argument, Argument]), [channel, value]).pipe(
      Effect.map(([target, payload]) => ({
        tokens: [name, target, payload] as const,
        // Shard channels need a topology-specific route; they are not keyspace keys.
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

/** The count reports server recipients, not successful application processing. */
export const publish = (channel: RedisArgument, value: RedisArgument) =>
  publication("PUBLISH", channel, value);

export const spublish = (channel: RedisArgument, value: RedisArgument) =>
  publication("SPUBLISH", channel, value);
