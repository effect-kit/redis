import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { getMetadata } from "#/commands/strings/Get";
import type { SetOptions } from "#/commands/strings/SetOptions";
import { Commands, defineCommand, Reply } from "#/index";
import type { RedisArgument } from "#/RedisArgument";

it.effect("built-in preparation still rejects caller input lazily on every execution", () =>
  Effect.gen(function* () {
    const invalidKey = 42 as unknown as RedisArgument;
    const command = Commands.getBytes(invalidKey);

    expect(yield* Effect.flip(command.prepare)).toMatchObject({
      _tag: "CommandInputError",
      reason: "arguments",
      delivery: "unsent",
    });

    const options: { condition: "NX" | "XX" } = { condition: "NX" };
    const set = Commands.set("key", "value", options);
    const first = yield* set.prepare;
    options.condition = "XX";
    const second = yield* set.prepare;

    expect(first.tokens).toEqual(["SET", "key", "value", "NX"]);
    expect(second.tokens).toEqual(["SET", "key", "value", "XX"]);

    const invalid = { condition: "invalid" } as unknown as SetOptions;
    expect(yield* Effect.flip(Commands.set("key", "value", invalid).prepare)).toMatchObject({
      _tag: "CommandInputError",
      reason: "options",
    });
  }),
);

it.effect("borrowing built-in metadata never grants custom descriptors trusted routing", () =>
  Effect.gen(function* () {
    const custom = defineCommand({
      metadata: getMetadata,
      tokens: ["GET", "key"],
      routing: { _tag: "Keys", keys: [{ index: 2, access: "read" }] },
      decode: Reply.status("OK"),
    });

    expect(yield* Effect.flip(custom.prepare)).toMatchObject({
      _tag: "CommandInputError",
      reason: "routing",
    });
  }),
);
