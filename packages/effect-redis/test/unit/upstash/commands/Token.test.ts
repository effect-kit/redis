import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands } from "#/upstash";
import { blob } from "#test/support/commands/CoreCase";

it.effect("ACL RESTTOKEN splits command words and keeps credentials/results redacted", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.aclRestToken(
      Redacted.make("fixture-user"),
      Redacted.make("fixture-password"),
    ).prepare;
    expect(prepared.tokens).toEqual(["ACL", "RESTTOKEN", "fixture-user", "fixture-password"]);
    expect(prepared.metadata.name).toBe("ACL RESTTOKEN");
    const result = yield* decodeReply(prepared, blob("fixture-generated-token"));

    expect(Redacted.value(result)).toBe("fixture-generated-token");
    expect(JSON.stringify(result)).not.toContain("fixture-generated-token");
    const error = yield* Effect.flip(
      decodeReply(prepared, {
        _tag: "SimpleError",
        value: new TextEncoder().encode("ERR private-credential"),
      }),
    );
    expect(JSON.stringify(error)).not.toContain("private-credential");
  }),
);
