import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { sent } from "#test/support/connection/Controlled";
import { sentinelControlled } from "#test/support/sentinel/Controlled";

it.effect(
  "lazy cursor streams fail on ownership change before sending another server's cursor",
  () =>
    Effect.gen(function* () {
      const fixture = yield* sentinelControlled();
      const scan = yield* Effect.forkChild(
        Effect.flip(
          fixture.client.scanKeys({ count: 1 }).pipe(
            Stream.tap(() => fixture.client.refresh),
            Stream.runCollect,
          ),
        ),
      );
      const data = yield* fixture.data();
      yield* sent(
        data.fixture,
        ["SCAN", "0", "COUNT", "1"],
        "*2\r\n$1\r\n1\r\n*1\r\n$3\r\nkey\r\n",
      );
      yield* fixture.discovery("b");

      expect(yield* Fiber.join(scan)).toMatchObject({ reason: "topology-changed", plane: "data" });
      expect(fixture.acquired()).toBe(7);
      expect(yield* fixture.client.snapshot).toMatchObject({ revision: 2, activeOperations: 0 });
    }),
);
