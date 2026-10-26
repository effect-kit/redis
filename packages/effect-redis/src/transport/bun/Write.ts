import { Effect, Exit, Redacted } from "effect";

import { TransportError } from "#/errors/TransportError";

interface WriterSocket {
  readonly write: (bytes: Uint8Array) => number;
  readonly flush: () => void;
}

export const makeWriter = (
  current: () => WriterSocket | undefined,
  maximumBytes: number,
  unavailable: () => boolean,
  close: Effect.Effect<void>,
) => {
  let active:
    | { readonly pump: () => void; readonly fail: (error: TransportError) => void }
    | undefined;

  const write = (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (unavailable() || current() === undefined)
          return Effect.fail(new TransportError({ stage: "write", reason: "closed" }));

        if (active !== undefined)
          return Effect.fail(new TransportError({ stage: "write", reason: "unavailable" }));

        if (bytes.length > maximumBytes)
          return Effect.fail(new TransportError({ stage: "write", reason: "limit" }));

        if (bytes.length === 0) return Effect.void;

        const snapshot = new Uint8Array(bytes);

        return restore(
          Effect.callback<void, TransportError>((resume) => {
            let offset = 0;
            let finished = false;
            let pumping = false;
            let drainPending = false;

            const finish = (error?: TransportError) => {
              if (finished) return;
              finished = true;
              active = undefined;
              resume(error === undefined ? Effect.void : Effect.fail(error));
            };

            const pump = () => {
              if (pumping) {
                drainPending = true;
                return;
              }

              const socket = current();
              if (finished) return;
              if (socket === undefined || unavailable())
                return finish(new TransportError({ stage: "write", reason: "closed" }));

              try {
                pumping = true;
                while (offset < snapshot.length) {
                  const end = Math.min(offset + 64 * 1024, snapshot.length);
                  const accepted = socket.write(snapshot.subarray(offset, end));
                  if (finished) return;
                  if (accepted < 0)
                    return finish(new TransportError({ stage: "write", reason: "closed" }));

                  // Only advance by accepted bytes. A short send resumes on drain.
                  offset += accepted;
                  if (offset < end) {
                    socket.flush();
                    if (drainPending) {
                      drainPending = false;
                      continue;
                    }
                    return;
                  }
                }

                socket.flush();
                finish();
              } catch (cause) {
                finish(
                  new TransportError({ stage: "write", reason: "io", cause: Redacted.make(cause) }),
                );
              } finally {
                pumping = false;
              }
            };

            active = { pump, fail: finish };
            pump();

            return Effect.gen(function* () {
              finished = true;
              active = undefined;
              // A canceled short send may already contain command bytes on the wire.
              yield* close;
            });
          }),
        ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
      }),
    );

  return {
    write,
    drain: () => active?.pump(),
    fail: (error: TransportError) => active?.fail(error),
  };
};
