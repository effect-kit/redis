import { Deferred, Effect, Layer, Queue, Ref } from "effect";

import { TransportError } from "#/errors/TransportError";
import { Transport } from "#/transport/Transport";

export interface WriteAttempt {
  readonly bytes: Uint8Array;
  /** Accept a prefix to model partial writes; completion releases write backpressure. */
  readonly accept: (count: number) => Effect.Effect<void, TransportError>;
  readonly fail: (error: TransportError) => Effect.Effect<void>;
}

const closeError = (stage: "read" | "write") => new TransportError({ stage, reason: "closed" });

/** Per-test mechanical byte boundary. It neither parses RESP nor schedules replies. */
export const makeControlledTransport = Effect.fnUntraced(function* () {
  const incoming = yield* Queue.bounded<Uint8Array | undefined, TransportError>(16);
  const attempts = yield* Queue.bounded<WriteAttempt, TransportError>(16);
  const closed = yield* Deferred.make<void>();
  const eof = yield* Ref.make(false);
  const counts = yield* Ref.make({ acquired: 0, closed: 0, acceptedBytes: 0 });
  const captured = yield* Ref.make<ReadonlyArray<Uint8Array>>([]);

  const close = Effect.gen(function* () {
    if (!(yield* Deferred.succeed(closed, undefined))) return;

    yield* Ref.update(counts, (value) => ({
      ...value,
      closed: value.acquired === 0 ? 0 : value.closed + 1,
    }));
    yield* Queue.fail(incoming, closeError("read"));
    yield* Queue.fail(attempts, closeError("write"));
  });

  const write = Effect.fnUntraced(function* (bytes: Uint8Array) {
    if (yield* Deferred.isDone(closed)) return yield* closeError("write");
    if (bytes.byteLength > 65536)
      return yield* new TransportError({ stage: "write", reason: "limit" });

    const accepted = yield* Ref.make(0);
    const completion = yield* Deferred.make<void, TransportError>();
    const snapshot = bytes.slice();
    const attempt: WriteAttempt = {
      bytes: snapshot.slice(),
      accept: (count) =>
        Effect.gen(function* () {
          if ((yield* Deferred.isDone(closed)) || (yield* Deferred.isDone(completion)))
            return yield* closeError("write");

          const offset = yield* Ref.get(accepted);
          if (
            !Number.isSafeInteger(count) ||
            count <= 0 ||
            offset + count > snapshot.length ||
            (yield* Ref.get(counts)).acceptedBytes + count > 65536 ||
            (yield* Ref.get(captured)).length >= 256
          ) {
            return yield* new TransportError({ stage: "write", reason: "limit" });
          }

          yield* Ref.set(accepted, offset + count);
          yield* Ref.update(captured, (chunks) => [
            ...chunks,
            snapshot.slice(offset, offset + count),
          ]);

          yield* Ref.update(counts, (value) => ({
            ...value,
            acceptedBytes: value.acceptedBytes + count,
          }));

          if (offset + count === snapshot.length) yield* Deferred.succeed(completion, undefined);
        }),
      fail: (error) => Deferred.fail(completion, error).pipe(Effect.asVoid),
    };

    if (snapshot.length === 0) return;
    yield* Queue.offer(attempts, attempt);
    yield* Effect.raceFirst(
      Deferred.await(completion),
      Deferred.await(closed).pipe(Effect.andThen(Effect.fail(closeError("write")))),
    );
  });

  const open = Effect.acquireRelease(
    Effect.gen(function* () {
      if ((yield* Ref.get(counts)).acquired !== 0 || (yield* Deferred.isDone(closed))) {
        return yield* new TransportError({ stage: "open", reason: "unavailable" });
      }

      yield* Ref.update(counts, (value) => ({ ...value, acquired: value.acquired + 1 }));

      const read = Effect.gen(function* () {
        if (yield* Deferred.isDone(closed)) return yield* closeError("read");
        if (yield* Ref.get(eof)) return undefined;

        const chunk = yield* Queue.take(incoming);
        if (chunk === undefined) yield* Ref.set(eof, true);

        return chunk;
      });

      return { read, write, close };
    }),
    () => close,
  );

  yield* Effect.addFinalizer(() => close);

  return {
    layer: Layer.succeed(Transport, { open: () => open }),
    nextWrite: Queue.take(attempts),
    receive: (bytes: Uint8Array) =>
      bytes.length === 0 || bytes.length > 65536
        ? Effect.fail(new TransportError({ stage: "read", reason: "limit" }))
        : Queue.offer(incoming, bytes.slice()).pipe(Effect.asVoid),
    end: Queue.offer(incoming, undefined).pipe(Effect.asVoid),
    failRead: (error: TransportError) => Queue.fail(incoming, error).pipe(Effect.asVoid),
    observations: Ref.get(counts),
    written: Ref.get(captured).pipe(Effect.map((chunks) => chunks.map((chunk) => chunk.slice()))),
  };
});
