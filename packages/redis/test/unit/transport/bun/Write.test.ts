import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeWriter } from "#/transport/bun/Write";

it.effect("Bun short writes retain the exact offset and an admission snapshot", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const accepted: Array<number> = [];
    const counts = [2, 0, 2];
    const writer = makeWriter(
      () => ({
        write: (bytes) => {
          const count = counts.shift() ?? bytes.length;
          accepted.push(...bytes.subarray(0, count));
          Deferred.doneUnsafe(started, Effect.void);
          return count;
        },
        flush: () => {},
      }),
      16,
      () => false,
      Effect.void,
    );
    const bytes = new Uint8Array([0, 255, 128, 13]);
    const writing = yield* writer.write(bytes).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Effect.yieldNow;

    bytes.fill(7);
    writer.drain();
    writer.drain();
    yield* Fiber.join(writing);
    writer.drain();

    expect(accepted).toEqual([0, 255, 128, 13]);
  }),
);

it.effect("Bun writer rejects concurrent ownership and oversized input before sending", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let calls = 0;
    const writer = makeWriter(
      () => ({
        write: () => {
          calls++;
          Deferred.doneUnsafe(started, Effect.void);
          return 0;
        },
        flush: () => {},
      }),
      2,
      () => false,
      Effect.void,
    );

    expect(yield* Effect.flip(writer.write(new Uint8Array(3)))).toMatchObject({
      stage: "write",
      reason: "limit",
    });
    expect(calls).toBe(0);

    const writing = yield* writer.write(new Uint8Array(2)).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    expect(yield* Effect.flip(writer.write(new Uint8Array(1)))).toMatchObject({
      stage: "write",
      reason: "unavailable",
    });

    yield* Fiber.interrupt(writing);
    writer.drain();
    expect(calls).toBe(1);
  }),
);

it.effect("Bun native write failures retire ownership and retain redacted errors", () =>
  Effect.gen(function* () {
    let closed = false;
    const writer = makeWriter(
      () => ({
        write: () => {
          throw new Error("private peer detail");
        },
        flush: () => {},
      }),
      16,
      () => closed,
      Effect.sync(() => {
        closed = true;
      }),
    );

    const failure = yield* Effect.flip(writer.write(new Uint8Array([1])));

    expect(failure).toMatchObject({ stage: "write", reason: "io" });
    expect(JSON.stringify(failure)).not.toContain("private peer detail");
    expect(closed).toBe(true);
  }),
);
