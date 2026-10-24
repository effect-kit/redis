import type { Socket } from "node:net";

import { Deferred, Effect, Redacted } from "effect";

import { TransportError } from "../../errors/TransportError.js";
import type { TransportConnection } from "../Transport.js";
import { makeWriter } from "./Write.js";

type ResumeRead = (result: Effect.Effect<Uint8Array | undefined, TransportError>) => void;

/** Owns one physical socket, without reconnects or Redis-specific state. */
export const makeConnection = (
  socket: Socket,
  readyEvent: "connect" | "secureConnect",
  maximumWrite: number,
) => {
  const ready = Deferred.makeUnsafe<void, TransportError>();
  const closed = Deferred.makeUnsafe<void>();
  let ended = false;
  let aborted = false;
  let retired = false;
  let failure: unknown;
  let failed = false;
  let reader: ResumeRead | undefined;
  const error = (stage: "open" | "read") =>
    new TransportError({
      stage,
      reason: failed ? "io" : "closed",
      ...(failed ? { cause: Redacted.make(failure) } : {}),
    });
  const pump = () => {
    if (reader === undefined) return;
    const resume = reader;
    if (failed || aborted || (retired && !ended)) {
      reader = undefined;
      resume(Effect.fail(error("read")));
      return;
    }
    try {
      // Readable mode leaves backpressure with Node, instead of an unbounded data queue.
      const available = Math.min(socket.readableLength, 64 * 1024);
      const chunk: Uint8Array | null = socket.read(available);
      if (chunk !== null && chunk.length > 0) {
        reader = undefined;
        resume(Effect.succeed(new Uint8Array(chunk)));
      } else if (ended || socket.readableEnded) {
        reader = undefined;
        resume(Effect.succeed(undefined));
      }
    } catch (cause) {
      onError(cause);
    }
  };
  const onReady = () => {
    if (!retired && !aborted) Deferred.doneUnsafe(ready, Effect.void);
  };
  const onEnd = () => {
    ended = true;
    pump();
  };
  const onError = (cause: unknown) => {
    failed = true;
    failure = cause;
    Deferred.doneUnsafe(ready, Effect.fail(error("open")));
    socket.destroy();
    pump();
  };
  const onClose = () => {
    retired = true;
    Deferred.doneUnsafe(ready, Effect.fail(error("open")));
    pump();
    socket.off(readyEvent, onReady);
    socket.off("readable", pump);
    socket.off("end", onEnd);
    socket.off("error", onError);
    socket.off("close", onClose);
    Deferred.doneUnsafe(closed, Effect.void);
  };
  socket.on(readyEvent, onReady);
  socket.on("readable", pump);
  socket.on("end", onEnd);
  socket.on("error", onError);
  socket.on("close", onClose);
  const close = Effect.suspend(() => {
    aborted = true;
    Deferred.doneUnsafe(ready, Effect.fail(error("open")));
    pump();
    socket.destroy();
    return Deferred.await(closed);
  });
  const read = Effect.callback<Uint8Array | undefined, TransportError>((resume) => {
    if (reader !== undefined) {
      resume(Effect.fail(new TransportError({ stage: "read", reason: "unavailable" })));
      return;
    }
    reader = resume;
    pump();
    return Effect.sync(() => {
      if (reader === resume) reader = undefined;
    });
  });
  const connection: TransportConnection = {
    read,
    write: makeWriter(socket, maximumWrite, () => aborted || retired || ended || failed, close),
    close,
  };
  return { connection, ready: Deferred.await(ready), close };
};
