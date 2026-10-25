import { createConnection } from "node:net";
import { connect } from "node:tls";

import { Effect, Redacted } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";
import type { Certificates } from "#test/support/tls/Certificates";

/** Independent wire probe: readiness cannot pass because our codec and adapter share a bug. */
export const probe = (
  endpoint: number | string,
  tls?: Certificates,
  password?: Redacted.Redacted<string>,
) =>
  Effect.callback<void, FixtureError>((resume) => {
    const socket =
      tls === undefined
        ? createConnection(
            typeof endpoint === "number"
              ? { host: "127.0.0.1", port: endpoint }
              : { path: endpoint },
          )
        : connect({
            host: "127.0.0.1",
            port: typeof endpoint === "number" ? endpoint : 6379,
            servername: "redis.test",
            ca: tls.ca,
            cert: tls.clientCertificate,
            key: Redacted.value(tls.clientKey),
          });

    let result: Effect.Effect<void, FixtureError> | undefined;
    let response = "";

    const finish = (outcome: Effect.Effect<void, FixtureError>) => {
      if (result !== undefined) return;

      result = outcome;
      socket.destroy();
    };

    let authenticating = password !== undefined;
    const ping = () => socket.write("*1\r\n$4\r\nPING\r\n");

    const onReady = () => {
      if (password === undefined) {
        ping();
        return;
      }

      const secret = Buffer.from(Redacted.value(password));
      socket.write(
        Buffer.concat([
          Buffer.from(`*2\r\n$4\r\nAUTH\r\n$${secret.length}\r\n`),
          secret,
          Buffer.from("\r\n"),
        ]),
      );
    };

    const onError = (cause: Error) =>
      finish(Effect.fail(new FixtureError({ stage: "readiness", cause: Redacted.make(cause) })));

    const onData = (bytes: Buffer) => {
      response += bytes.toString("ascii");
      if (authenticating && response === "+OK\r\n") {
        authenticating = false;
        response = "";
        ping();
        return;
      }

      if (!authenticating && response === "+PONG\r\n") finish(Effect.void);
      else if (response.length >= 7)
        finish(Effect.fail(new FixtureError({ stage: "readiness-reply" })));
    };

    const onClose = () => {
      socket.off(tls === undefined ? "connect" : "secureConnect", onReady);
      socket.off("data", onData);
      socket.off("error", onError);
      resume(result ?? Effect.fail(new FixtureError({ stage: "readiness-closed" })));
    };

    socket.once(tls === undefined ? "connect" : "secureConnect", onReady);
    socket.on("error", onError);
    socket.on("data", onData);
    socket.once("close", onClose);

    return Effect.callback<void>((done) => {
      if (socket.closed) {
        done(Effect.void);
        return;
      }

      socket.once("close", () => done(Effect.void));
      socket.destroy();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 500,
      orElse: () => Effect.fail(new FixtureError({ stage: "readiness-timeout" })),
    }),
  );
