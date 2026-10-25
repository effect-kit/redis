import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";

import * as Commands from "#/commands/index";
import { clusterControlled } from "#test/support/cluster/Controlled";
import { sent } from "#test/support/connection/Controlled";

it.effect("lost EXEC retains indexed unknown outcomes and never moves the transaction", () =>
  Effect.gen(function* () {
    const { client, a, b } = yield* clusterControlled();
    const transaction = yield* Effect.forkChild(
      Effect.result(
        client.transaction([Commands.set("foo", "value"), Commands.incr("foo")] as const),
      ),
    );
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["MULTI"], "+OK\r\n");
    yield* sent(a, ["SET", "foo", "value"], "+QUEUED\r\n");
    yield* sent(a, ["INCR", "foo"], "+QUEUED\r\n");
    yield* sent(a, ["EXEC"]);
    yield* a.end;

    const result = yield* Fiber.join(transaction);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "BatchError", phase: "transaction-exec", execution: "unknown" },
    });
    if (result._tag === "Failure" && result.failure._tag === "BatchError")
      expect(Redacted.value(result.failure.outcomes)).toMatchObject([
        { _tag: "Unknown", index: 0 },
        { _tag: "Unknown", index: 1 },
      ]);
    expect((yield* b.observations).acquired).toBe(0);
  }),
);
