import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted, Result } from "effect";

import { makeExecutor } from "#/command/Executor";
import { Commands, fromPreparation } from "#/index";
import { makeRedis } from "#/Redis";
import { controlled, sent } from "#test/support/connection/Controlled";

it.effect.each(["owned", "custom"] as const)(
  "%s values execution decodes every slot once and preserves undefined successes in failure evidence",
  (kind) =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const executor = makeExecutor(connection);
      // A custom executor need not implement the private native optimization.
      const redis = makeRedis(kind === "owned" ? executor : { ...executor });
      const decoded: string[] = [];
      const command = (key: string, fail: boolean) =>
        fromPreparation(
          Commands.get(key).prepare.pipe(
            Effect.map((prepared) => ({
              ...prepared,
              decode: () =>
                Effect.sync(() => {
                  decoded.push(key);
                }).pipe(Effect.andThen(fail ? Effect.fail("application-codec") : Effect.void)),
            })),
          ),
        );

      const running = yield* Effect.forkChild(
        Effect.flip(redis.batch([command("a", false), command("b", true), command("c", false)])),
      );
      yield* sent(fixture, ["GET", "a"]);
      yield* sent(fixture, ["GET", "b"]);
      yield* sent(fixture, ["GET", "c"], "$-1\r\n$-1\r\n$-1\r\n");

      const failure = yield* Fiber.join(running);
      if (typeof failure !== "object" || failure._tag !== "BatchError")
        return yield* Effect.die(failure);
      expect(decoded).toEqual(["a", "b", "c"]);
      expect(Redacted.value(failure.outcomes)).toEqual([
        { _tag: "Completed", index: 0, result: Result.succeed(undefined) },
        { _tag: "Completed", index: 1, result: Result.fail("application-codec") },
        { _tag: "Completed", index: 2, result: Result.succeed(undefined) },
      ]);
    }),
);
