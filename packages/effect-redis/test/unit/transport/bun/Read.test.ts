import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeReader } from "#/transport/bun/Read";

it.effect("Bun callback bytes are owned and large chunks drain before clean EOF", () =>
  Effect.gen(function* () {
    const reader = makeReader(1024 * 1024, () => {});
    const borrowed = new Uint8Array(256 * 1024).fill(17);
    reader.receive(borrowed);
    borrowed.fill(99);
    reader.end();

    let received = 0;
    while (true) {
      const chunk = yield* reader.read;
      if (chunk === undefined) break;

      expect(chunk.length).toBeLessThanOrEqual(65536);
      expect(chunk.every((byte) => byte === 17)).toBe(true);
      received += chunk.length;
    }

    expect(received).toBe(borrowed.length);
  }),
);

it.effect("Bun reads enforce retained byte and callback-count limits", () =>
  Effect.gen(function* () {
    const bytes = makeReader(2, () => {});
    bytes.receive(new Uint8Array(2));
    expect(bytes.receive(new Uint8Array(1))).toMatchObject({ reason: "limit" });
    expect(yield* Effect.flip(bytes.read)).toMatchObject({ stage: "read", reason: "limit" });

    const chunks = makeReader(1024, () => {});
    for (let index = 0; index < 128; index++) chunks.receive(new Uint8Array(1));
    expect(chunks.receive(new Uint8Array(1))).toMatchObject({ reason: "limit" });
    expect(yield* Effect.flip(chunks.read)).toMatchObject({ reason: "limit" });
  }),
);

it.effect("Bun read cancellation releases only its waiter and preserves future bytes", () =>
  Effect.gen(function* () {
    const waiting = yield* Deferred.make<void>();
    const reader = makeReader(16, () => Deferred.doneUnsafe(waiting, Effect.void));
    const first = yield* reader.read.pipe(Effect.forkChild);
    yield* Deferred.await(waiting);

    expect(yield* Effect.flip(reader.read)).toMatchObject({ reason: "unavailable" });
    yield* Fiber.interrupt(first);
    reader.receive(new Uint8Array([0, 255]));

    expect(yield* reader.read).toEqual(new Uint8Array([0, 255]));
  }),
);
