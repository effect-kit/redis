import { Deferred, Effect, Redacted } from "effect";

import type { Socket, SocketHandler } from "bun";

import { TransportError } from "#/errors/TransportError";
import { verifyIdentity } from "#/transport/bun/Identity";
import { makeReader } from "#/transport/bun/Read";
import { makeWriter } from "#/transport/bun/Write";
import type { TransportConnection } from "#/transport/Transport";

/** Owns callbacks from the beginning of acquisition, including late connect completion. */
export const makePhysical = (
  maximumWrite: number,
  maximumRead: number,
  tls: boolean,
  expectedIdentity?: string,
) => {
  const ready = Deferred.makeUnsafe<void, TransportError>();
  const settled = Deferred.makeUnsafe<void>();
  const closed = Deferred.makeUnsafe<void>();

  let socket: Socket | undefined;
  let stopping = false;
  let retired = false;
  let ended = false;
  let failure: TransportError | undefined;

  const reader = makeReader(maximumRead, () => socket?.resume());
  const error = (stage: "open" | "read" | "write") =>
    new TransportError({
      stage,
      reason: failure?.reason ?? "closed",
      ...(failure?.cause === undefined ? {} : { cause: failure.cause }),
    });

  const terminate = () => {
    socket?.terminate();
  };

  const close = Effect.gen(function* () {
    stopping = true;
    Deferred.doneUnsafe(ready, Effect.fail(error("open")));
    reader.fail(error("read"));
    writer.fail(error("write"));
    terminate();

    // Bun.connect has no abort handle before TCP establishment. Join its settlement
    // and terminate a late socket rather than returning with an orphaned acquisition.
    yield* Deferred.await(settled);
    if (!retired) terminate();
    yield* Deferred.await(closed);
  });

  const writer = makeWriter(
    () => socket,
    maximumWrite,
    () => stopping || retired || ended || failure !== undefined,
    close,
  );

  const fail = (cause: unknown) => {
    failure ??= new TransportError({
      stage: "open",
      reason: "io",
      cause: Redacted.make(cause),
    });
    Deferred.doneUnsafe(ready, Effect.fail(failure));
    reader.fail(error("read"));
    writer.fail(error("write"));
    terminate();
  };

  const attach = (connected: Socket) => {
    socket = connected;
    if (stopping || retired || failure !== undefined) connected.terminate();
  };

  const handlers: SocketHandler<undefined> = {
    binaryType: "uint8array",
    open: (connected) => {
      attach(connected);
      if (!tls && !stopping && !retired) {
        connected.pause();
        Deferred.doneUnsafe(ready, Effect.void);
      }
    },
    ...(tls
      ? {
          handshake: (connected: Socket, success: boolean, authorizationError: Error | null) => {
            attach(connected);
            // Bun reports failed certificate authorization even when explicitly permitted.
            if (!success && expectedIdentity !== undefined) return fail(authorizationError);
            if (stopping || retired || failure !== undefined) return;

            try {
              if (expectedIdentity !== undefined) verifyIdentity(connected, expectedIdentity);
            } catch (cause) {
              return fail(cause);
            }

            connected.pause();
            Deferred.doneUnsafe(ready, Effect.void);
          },
        }
      : {}),
    data: (connected, bytes) => {
      connected.pause();
      if (stopping || retired || failure !== undefined) return;

      const overflow = reader.receive(bytes);
      if (overflow !== undefined) {
        failure = overflow;
        writer.fail(overflow);
        terminate();
      }
    },
    drain: () => writer.drain(),
    end: () => {
      ended = true;
      reader.end();
      writer.fail(error("write"));
    },
    error: (_connected, cause) => fail(cause),
    connectError: (_connected, cause) => {
      fail(cause);
    },
    close: (_connected, cause) => {
      retired = true;
      if (cause !== undefined) fail(cause);
      else if (ended) reader.end();
      else reader.fail(error("read"));

      writer.fail(error("write"));
      Deferred.doneUnsafe(ready, Effect.fail(error("open")));
      Deferred.doneUnsafe(closed, Effect.void);
    },
  };

  const start = (acquire: () => Promise<Socket>) => {
    try {
      acquire().then(
        (connected) => {
          attach(connected);
          return Deferred.doneUnsafe(settled, Effect.void);
        },
        (cause: unknown) => {
          fail(cause);
          retired = true;
          Deferred.doneUnsafe(settled, Effect.void);
          Deferred.doneUnsafe(closed, Effect.void);
        },
      );
    } catch (cause) {
      fail(cause);
      retired = true;
      Deferred.doneUnsafe(settled, Effect.void);
      Deferred.doneUnsafe(closed, Effect.void);
    }
  };

  const connection: TransportConnection = { read: reader.read, write: writer.write, close };

  return { handlers, start, connection, close, ready: Deferred.await(ready) };
};
