import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Socket } from "node:net";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";
import type { Certificates } from "#test/support/tls/Certificates";

/** Own listener and accepted sockets before listen; native fetch tests need awaited teardown. */
export const httpServer = Effect.fnUntraced(function* (
  respond: (
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ) => void | Promise<void>,
  tls?: Certificates,
) {
  const sockets = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  const controller = new AbortController();
  const respondOwned = (request: IncomingMessage, response: ServerResponse) => {
    const operation = Promise.resolve().then(() => respond(request, response, controller.signal));
    pending.add(operation);
    void operation.catch(() => response.destroy()).finally(() => pending.delete(operation));
  };

  const server = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const listening =
        tls === undefined
          ? createServer(respondOwned)
          : createHttpsServer(
              { key: Redacted.value(tls.serverKey), cert: tls.serverCertificate },
              respondOwned,
            );
      listening.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      return listening;
    }),
    (listening) =>
      Effect.promise<void>(async () => {
        controller.abort();
        for (const socket of sockets) socket.destroy();
        if (listening.listening)
          await new Promise<void>((resolve, reject) =>
            listening.close((error) => (error === undefined ? resolve() : reject(error))),
          );
        await Promise.allSettled(pending);
      }),
  );

  yield* Effect.callback<void, FixtureError>((resume) => {
    const failed = (cause: Error) =>
      resume(Effect.fail(new FixtureError({ stage: "http-listen", cause: Redacted.make(cause) })));
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", failed);
      resume(Effect.void);
    });
  }).pipe(Effect.uninterruptible);

  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* new FixtureError({ stage: "http-address" });
  return {
    url: `${tls === undefined ? "http" : "https"}://127.0.0.1:${address.port}`,
    sockets,
    server,
  };
});

export const requestBody = async (request: IncomingMessage) => {
  const chunks: Array<Buffer> = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes: Buffer = chunk;
    length += bytes.length;
    if (length > 8 * 1024 * 1024) throw new Error("Fixture request budget exceeded");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};
