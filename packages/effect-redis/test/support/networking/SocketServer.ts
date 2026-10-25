import { createServer } from "node:net";
import type { Server, Socket } from "node:net";

import { Deferred, Effect } from "effect";

/** A real loopback byte peer. Socket errors are captured for deliberate fault assertions. */
export const listen = Effect.fnUntraced(function* (server: Server, path?: string) {
  const sockets = new Set<Socket>();
  const errors: Array<Error> = [];
  const first = Deferred.makeUnsafe<Socket>();

  let accepted = 0;
  let closed = 0;
  let closing = false;
  let listenerClosed = false;

  const stopped = Deferred.makeUnsafe<void, Error>();
  const finishClose = () => {
    if (listenerClosed && sockets.size === 0) Deferred.doneUnsafe(stopped, Effect.void);
  };

  const track = (socket: Socket) => {
    accepted++;
    sockets.add(socket);
    socket.on("error", (error) => {
      if (errors.length < 16) errors.push(error);
    });
    socket.once("close", () => {
      sockets.delete(socket);
      closed++;
      finishClose();
    });
    Deferred.doneUnsafe(first, Effect.succeed(socket));
  };

  server.on("connection", track);

  const close = Effect.suspend(() => {
    if (!closing) {
      closing = true;
      for (const socket of sockets) socket.destroy();
      server.close((error?: Error) => {
        server.off("connection", track);
        if (error !== undefined && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")) {
          Deferred.doneUnsafe(stopped, Effect.fail(error));
          return;
        }
        listenerClosed = true;
        finishClose();
      });
    }

    return Deferred.await(stopped);
  });

  yield* Effect.acquireRelease(Effect.succeed(server), () => close.pipe(Effect.orDie));
  yield* Effect.callback<void, Error>((resume) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      resume(Effect.fail(error));
    };
    server.once("error", onError);

    const onListening = () => {
      server.off("error", onError);
      resume(Effect.void);
    };

    if (path === undefined) server.listen({ host: "127.0.0.1", port: 0 }, onListening);
    else server.listen(path, onListening);
    return Effect.sync(() => {
      server.off("error", onError);
    });
  });

  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;

  return {
    port,
    path,
    first: Deferred.await(first),
    sockets,
    errors,
    close,
    counts: () => ({ accepted, closed }),
  };
});

export const loopback = Effect.fnUntraced(function* (
  accept: (socket: Socket) => void,
  options?: { readonly path?: string; readonly allowHalfOpen?: boolean },
) {
  return yield* listen(
    createServer({ allowHalfOpen: options?.allowHalfOpen ?? false }, accept),
    options?.path,
  );
});
