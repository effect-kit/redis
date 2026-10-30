import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands } from "#/index";

it.effect("decoder invocation is deferred and synchronous throws remain defects", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.incr("counter").prepare;
    const defect = new Error("application decoder defect");
    let invoked = false;
    const decoded = decodeReply(
      {
        ...prepared,
        decode: () => {
          invoked = true;
          throw defect;
        },
      },
      { _tag: "Integer", value: 1n },
    );

    expect(invoked).toBe(false);
    const exit = yield* Effect.exit(decoded);
    expect(invoked).toBe(true);
    if (exit._tag === "Success") return yield* Effect.die("Expected decoder defect");
    expect(Cause.findDefect(exit.cause)).toMatchObject({ success: defect });
  }),
);
