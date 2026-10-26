import { createServer } from "node:tls";

import { Effect, Redacted } from "effect";

import { listen } from "#test/support/networking/SocketServer";
import type { Certificates } from "#test/support/tls/Certificates";

export const tlsServer = Effect.fnUntraced(function* (
  identity: Certificates,
  requireClient = false,
) {
  const names: Array<string | false | null> = [];
  const failures: Array<Error> = [];
  const authorized: Array<boolean> = [];

  const server = createServer(
    {
      cert: identity.serverCertificate,
      key: Redacted.value(identity.serverKey),
      ca: identity.ca,
      requestCert: requireClient,
      rejectUnauthorized: true,
    },
    (socket) => {
      socket.on("error", (error) => {
        if (failures.length < 16) failures.push(error);
      });

      names.push(socket.servername);
      authorized.push(socket.authorized);
      socket.on("data", (bytes) => socket.write(bytes));
    },
  );

  server.on("tlsClientError", (error) => {
    if (failures.length < 16) failures.push(error);
  });

  return { ...(yield* listen(server)), names, failures, authorized };
});
