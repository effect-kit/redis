import { Effect, Schedule } from "effect";

import { exchange } from "#test/support/networking/Exchange";
import { FixtureError } from "#test/support/servers/FixtureError";

/** Observe the actual blocked server connection before appending, rather than racing a sleep. */
export const waitForBlockedRead = (
  oracle: Parameters<typeof exchange>[0],
  command: "xread" | "xreadgroup" | "ts.read",
) =>
  Effect.gen(function* () {
    const reply = yield* exchange(oracle, ["CLIENT", "LIST"]);
    if (reply._tag !== "BlobString") return yield* new FixtureError({ stage: "client-list-reply" });
    const ready = new TextDecoder()
      .decode(reply.value)
      .split("\n")
      .some(
        (line) =>
          line.includes(`cmd=${command} `) &&
          line
            .split(" ")
            .some((field) => field.startsWith("flags=") && field.slice(6).includes("b")),
      );
    if (!ready) return yield* new FixtureError({ stage: "reader-not-blocked" });
  }).pipe(Effect.retry({ schedule: Schedule.spaced(10), times: 200 }));
