import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { pingMetadata } from "#/commands/connection/Ping";
import { defineCommand, Reply } from "#/index";

it.effect("caller-owned metadata and arguments remain lazy and revalidate after mutation", () =>
  Effect.gen(function* () {
    const metadata = {
      ...pingMetadata,
      scenarios: [...pingMetadata.scenarios] as [string, ...string[]],
    };
    const tokens: [string, ...string[]] = ["PING"];
    const command = defineCommand({
      metadata,
      tokens,
      routing: { _tag: "Keyless" },
      decode: Reply.status("PONG"),
    });
    const first = yield* command.prepare;
    metadata.scenarios[0] = "changed";
    tokens[0] = "ECHO";

    const second = yield* command.prepare;
    expect(first.metadata.scenarios[0]).not.toBe("changed");
    expect(first.tokens).toEqual(["PING"]);
    expect(second.metadata.scenarios[0]).toBe("changed");
    expect(second.tokens).toEqual(["ECHO"]);

    metadata.scenarios[0] = "";
    expect(yield* Effect.flip(command.prepare)).toMatchObject({
      _tag: "CommandInputError",
      reason: "metadata",
    });
  }),
);
