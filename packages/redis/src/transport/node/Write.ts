import type { Socket } from "node:net";

import { Effect, Exit, Redacted } from "effect";

import { TransportError } from "#/errors/TransportError";

const chunkBytes = 64 * 1024;

/** A single owner writes bounded chunks; local completion never proves remote execution. */
export const makeWriter = (
  socket: Socket,
  maximum: number,
  unavailable: () => boolean,
  close: Effect.Effect<void>,
) => {
  let busy = false;

  return (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (unavailable())
          return Effect.fail(new TransportError({ stage: "write", reason: "closed" }));

        if (busy) return Effect.fail(new TransportError({ stage: "write", reason: "unavailable" }));
        if (bytes.byteLength > maximum)
          return Effect.fail(new TransportError({ stage: "write", reason: "limit" }));
        if (bytes.byteLength === 0) return Effect.void;

        const snapshot = new Uint8Array(bytes);
        busy = true;

        return restore(
          Effect.callback<void, TransportError>((resume) => {
            let offset = 0;
            let finished = false;
            let flushed = false;
            let drained = true;

            const cleanup = () => {
              socket.off("error", onError);
              socket.off("close", onClose);
              socket.off("drain", onDrain);
            };

            const finish = (error?: TransportError) => {
              if (finished) return;
              finished = true;
              cleanup();
              resume(error === undefined ? Effect.void : Effect.fail(error));
            };

            const onError = (cause: Error) =>
              finish(
                new TransportError({
                  stage: "write",
                  reason: "io",
                  cause: Redacted.make(cause),
                }),
              );

            const onClose = () => finish(new TransportError({ stage: "write", reason: "closed" }));

            // Node write callbacks and drain are independent; wait for both before advancing.
            const advance = () => {
              if (finished || !flushed || !drained) return;
              if (offset === snapshot.length) return finish();
              send();
            };

            const onDrain = () => {
              drained = true;
              advance();
            };

            const send = () => {
              if (unavailable()) return onClose();

              const end = Math.min(offset + chunkBytes, snapshot.length);
              const chunk = snapshot.subarray(offset, end);
              offset = end;
              flushed = false;

              try {
                drained = socket.write(chunk, (error) => {
                  if (finished) return;
                  if (error) return onError(error);

                  flushed = true;
                  advance();
                });
              } catch (cause) {
                finish(
                  new TransportError({ stage: "write", reason: "io", cause: Redacted.make(cause) }),
                );
              }
            };

            socket.on("error", onError);
            socket.on("close", onClose);
            socket.on("drain", onDrain);

            send();

            return Effect.gen(function* () {
              finished = true;
              cleanup();
              // A canceled native write may have sent a prefix. Never reuse this socket.
              yield* close;
            });
          }),
        ).pipe(
          Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)),
          Effect.ensuring(
            Effect.sync(() => {
              busy = false;
            }),
          ),
        );
      }),
    );
};
