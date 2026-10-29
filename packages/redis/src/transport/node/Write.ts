import type { Socket } from "node:net";

import { Effect, Exit, Redacted } from "effect";

import { TransportError } from "#/errors/TransportError";
import { ownWrite } from "#/transport/Ownership";

const chunkBytes = 64 * 1024;

type Resume = (result: Effect.Effect<void, TransportError>) => void;

interface PendingWrite {
  readonly snapshot: Uint8Array;
  readonly resume: Resume;
  offset: number;
  flushed: boolean;
  drained: boolean;
}

/** A single owner writes bounded chunks; local completion never proves remote execution. */
export const makeWriter = (
  socket: Socket,
  maximum: number,
  unavailable: () => boolean,
  close: Effect.Effect<void>,
) => {
  let busy = false;
  let pending: PendingWrite | undefined;

  const finish = (error?: TransportError) => {
    const active = pending;
    if (active === undefined) return;
    pending = undefined;
    active.resume(error === undefined ? Effect.void : Effect.fail(error));
  };

  const onError = (cause: unknown) => {
    if (pending === undefined) return;
    finish(new TransportError({ stage: "write", reason: "io", cause: Redacted.make(cause) }));
  };

  const onClose = () => {
    socket.off("error", onError);
    socket.off("close", onClose);
    socket.off("drain", onDrain);
    if (pending !== undefined) finish(new TransportError({ stage: "write", reason: "closed" }));
  };

  // Callback completion and drain are independent. The socket listeners live
  // with the connection; a late callback can only advance its own write state.
  const advance = (active: PendingWrite) => {
    if (pending !== active || !active.flushed || !active.drained) return;
    if (active.offset === active.snapshot.length) finish();
    else send(active);
  };

  const onDrain = () => {
    if (pending === undefined) return;
    pending.drained = true;
    advance(pending);
  };

  const send = (active: PendingWrite) => {
    if (unavailable()) return onClose();
    const end = Math.min(active.offset + chunkBytes, active.snapshot.length);
    const chunk = active.snapshot.subarray(active.offset, end);
    active.offset = end;
    active.flushed = false;

    try {
      active.drained = socket.write(chunk, (error) => {
        if (pending !== active) return;
        if (error) return onError(error);
        active.flushed = true;
        advance(active);
      });
    } catch (cause) {
      onError(cause);
    }
  };

  socket.on("error", onError);
  socket.on("close", onClose);
  socket.on("drain", onDrain);

  const write = (bytes: Uint8Array, owned: boolean): Effect.Effect<void, TransportError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (unavailable())
          return Effect.fail(new TransportError({ stage: "write", reason: "closed" }));
        if (busy) return Effect.fail(new TransportError({ stage: "write", reason: "unavailable" }));
        if (bytes.byteLength > maximum)
          return Effect.fail(new TransportError({ stage: "write", reason: "limit" }));
        if (bytes.byteLength === 0) return Effect.void;

        const snapshot = owned ? bytes : new Uint8Array(bytes);
        busy = true;

        return restore(
          Effect.callback<void, TransportError>((resume) => {
            const active: PendingWrite = {
              snapshot,
              resume,
              offset: 0,
              flushed: false,
              drained: true,
            };
            pending = active;
            send(active);

            return Effect.suspend(() => {
              if (pending === active) pending = undefined;
              // Cancellation after a possible prefix must retire the physical socket.
              return close;
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

  return ownWrite(
    (bytes) => write(bytes, false),
    (bytes) => write(bytes, true),
  );
};
