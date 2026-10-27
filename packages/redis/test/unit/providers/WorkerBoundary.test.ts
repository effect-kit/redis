import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import worker from "#test/runners/providers/worker";
import { deploymentHeader, workerResponse } from "#test/runners/providers/WorkerResponse";
import {
  checkWorkerBoundary,
  waitForWorkerBoundary,
} from "#test/support/providers/workers/Boundary";

const probe = { id: "unauthorized", expected: 403 };

it.effect("waits for the selected deployment without accepting a stale successful response", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    let attempts = 0;
    const operation = Effect.gen(function* () {
      attempts++;
      yield* Deferred.succeed(first, undefined);
      return yield* checkWorkerBoundary(
        "current",
        probe,
        attempts === 1
          ? new Response("old worker", { status: 200 })
          : workerResponse(new Response(null, { status: 403 }), "current"),
      );
    });
    const waiting = yield* waitForWorkerBoundary(operation).pipe(Effect.forkChild);
    yield* Deferred.await(first);
    yield* TestClock.adjust(200);
    yield* Fiber.join(waiting);

    expect(attempts).toBe(2);
  }),
);

it.effect("a current-deployment access failure is fatal on its first attempt", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const failure = yield* Effect.flip(
      waitForWorkerBoundary(
        Effect.suspend(() => {
          attempts++;
          return checkWorkerBoundary(
            "current",
            probe,
            workerResponse(new Response(null, { status: 200 }), "current"),
          );
        }),
      ),
    );

    expect(failure.stage).toBe("worker-access-unauthorized-200");
    expect(attempts).toBe(1);
  }),
);

it.effect("an unknown serving deployment cannot wait beyond the readiness deadline", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    const operation = Deferred.succeed(first, undefined).pipe(
      Effect.andThen(checkWorkerBoundary("current", probe, new Response(null, { status: 200 }))),
    );
    const waiting = yield* Effect.flip(waitForWorkerBoundary(operation)).pipe(Effect.forkChild);
    yield* Deferred.await(first);
    yield* TestClock.adjust(15_000);

    expect((yield* Fiber.join(waiting)).stage).toBe("worker-propagation-timeout");
  }),
);

it("all control responses identify their deployment and forbid shared readiness caching", async () => {
  const env = {
    UPSTASH_URL: "https://example.invalid",
    UPSTASH_TOKEN: "synthetic",
    RUN_KEY: "synthetic-run-key",
    RUN_EXPIRES_AT: String(Date.now() + 60_000),
    COMPATIBILITY_DATE: "2026-10-26",
    VERSION: { id: "current" },
  };
  const responses = [
    await worker.fetch(new Request("https://worker.example.test/ready"), env),
    await worker.fetch(
      new Request("https://worker.example.test/ready", {
        headers: { authorization: "Bearer synthetic-run-key" },
      }),
      env,
    ),
    await worker.fetch(
      new Request("https://worker.example.test/test", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-run-key" },
        body: '{"scenario":"data","prefix":"shared:"}',
      }),
      env,
    ),
    await worker.fetch(
      new Request("https://worker.example.test/test", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-run-key" },
        body: "x".repeat(1025),
      }),
      env,
    ),
  ];

  expect(responses.map((response) => response.status)).toEqual([403, 200, 400, 413]);
  for (const response of responses) {
    expect(response.headers.get(deploymentHeader)).toBe("current");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("authorization");
  }
});
