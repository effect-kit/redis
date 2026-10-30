import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { bytes, controlled, sent } from "#test/support/connection/Controlled";

it.effect("coalesced replies retain FIFO order across bounded reader turns and feeds", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled({
      limits: {
        maxBufferedBytes: 32,
        maxBlobBytes: 16,
        maxHeaderBytes: 8,
        maxInFlightCommands: 256,
      },
    });
    const requests = [];

    for (let index = 0; index < 150; index++) {
      requests.push(yield* Effect.forkChild(connection.executeOrdinary(["INCR", `${index}`])));
      yield* sent(fixture, ["INCR", `${index}`]);
    }

    yield* fixture.receive(
      bytes(Array.from({ length: 150 }, (_, index) => `:${index}\r\n`).join("")),
    );
    const replies = yield* Effect.forEach(requests, Fiber.join);

    expect(replies).toEqual(
      Array.from({ length: 150 }, (_, index) => ({ _tag: "Integer", value: BigInt(index) })),
    );
    expect(yield* connection.snapshot).toMatchObject({ replies: 150, inFlightCommands: 0 });
  }),
);

it.effect("a malformed coalesced suffix cannot erase an earlier known reply", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const known = yield* Effect.forkChild(connection.executeOrdinary(["INCR", "a"]));
    yield* sent(fixture, ["INCR", "a"]);
    const invalid = yield* Effect.forkChild(Effect.flip(connection.executeOrdinary(["INCR", "b"])));
    yield* sent(fixture, ["INCR", "b"], ":1\r\n:invalid\r\n");

    expect(yield* Fiber.join(known)).toEqual({ _tag: "Integer", value: 1n });
    expect(yield* Fiber.join(invalid)).toMatchObject({
      reason: "protocol",
      delivery: "possibly-written",
    });
    expect(yield* connection.snapshot).toMatchObject({ replies: 1, retiredGenerations: 1 });
  }),
);
