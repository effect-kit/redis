import { Effect } from "effect";

import { blob } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

const echoCommand = (name: "ECHO" | "PING", value: RedisArgument) =>
  ordinary(
    metadata(name, "connection", ["COMMAND-01"]),
    blob,
    parse(Argument, value).pipe(
      Effect.map((selected) => ({
        tokens: [name, selected] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

export const echo = (value: RedisArgument) => echoCommand("ECHO", value);

/** A message changes PING's result shape from status to an echoed binary blob. */
export const pingMessage = (value: RedisArgument) => echoCommand("PING", value);
