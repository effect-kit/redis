import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";

import { keySlot } from "#/cluster/Slot";
import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { sent } from "#test/support/connection/Controlled";

it.effect("failed physical retirement prevents acquisition on the replacement node", () =>
  Effect.gen(function* () {
    const scoped = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          const { client, seed, a, b } = yield* clusterControlled({}, "a");
          const request = yield* Effect.forkChild(Effect.exit(client.redis.get("foo")));
          yield* sent(a, ["READWRITE"], "+OK\r\n");
          yield* sent(a, ["GET", "foo"], `-MOVED ${keySlot("foo")} b:6379\r\n`);
          yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("b", "node-b"));
          expect(Exit.hasDies(yield* Fiber.join(request))).toBe(true);

          const next = yield* Effect.exit(client.redis.get("foo"));
          expect(Exit.hasDies(next)).toBe(true);
          expect((yield* b.observations).acquired).toBe(0);
          if (Exit.isFailure(next)) return yield* Effect.failCause(next.cause);
        }),
      ),
    );

    expect(Exit.hasDies(scoped)).toBe(true);
  }),
);
