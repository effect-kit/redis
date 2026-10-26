import { createConnection } from "node:net";
import { connect } from "node:tls";

import { Effect, Redacted, Schedule } from "effect";

import { FixtureError } from "#test/support/servers/FixtureError";
import type { Certificates } from "#test/support/tls/Certificates";

export interface ReadinessObservation {
  readonly outcome: "ready" | "io-error" | "invalid-reply" | "empty-close" | "interrupted";
  readonly elapsedMillis: number;
  readonly receivedBytes: number;
  readonly code?: "ECONNREFUSED" | "ECONNRESET" | "EPIPE" | "ETIMEDOUT";
}

/** The configured startup deadline owns readiness independently of how quickly probes fail. */
export const awaitReadiness = (attempt: Effect.Effect<void, FixtureError>, millis = 10_000) =>
  attempt.pipe(
    Effect.retry({ schedule: Schedule.spaced(50) }),
    Effect.timeoutOrElse({
      duration: millis,
      orElse: () => Effect.fail(new FixtureError({ stage: "server-readiness" })),
    }),
  );

/** Independent wire probe: readiness cannot pass because our codec and adapter share a bug. */
export const probe = (
  endpoint: number | string,
  tls?: Certificates,
  password?: Redacted.Redacted<string>,
  observe?: (observation: ReadinessObservation) => void,
) =>
  Effect.callback<void, FixtureError>((resume) => {
    const began = performance.now();
    let outcome: ReadinessObservation["outcome"] = "empty-close";
    let receivedBytes = 0;
    let code: ReadinessObservation["code"];
    let reported = false;
    const report = Effect.sync(() => {
      if (reported) return;
      reported = true;
      observe?.({
        outcome,
        elapsedMillis: performance.now() - began,
        receivedBytes,
        ...(code === undefined ? {} : { code }),
      });
    });
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

    const finish = (completion: Effect.Effect<void, FixtureError>) => {
      if (result !== undefined) return;

      result = completion;
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

    const onError = (cause: Error) => {
      outcome = "io-error";
      if (
        "code" in cause &&
        ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(String(cause.code))
      )
        code = cause.code as ReadinessObservation["code"];
      finish(Effect.fail(new FixtureError({ stage: "readiness", cause: Redacted.make(cause) })));
    };

    const onData = (bytes: Buffer) => {
      receivedBytes += bytes.length;
      response += bytes.toString("ascii");
      if (authenticating && response === "+OK\r\n") {
        authenticating = false;
        response = "";
        ping();
        return;
      }

      if (!authenticating && response === "+PONG\r\n") {
        outcome = "ready";
        finish(Effect.void);
      } else if (response.length >= 7) {
        outcome = "invalid-reply";
        finish(Effect.fail(new FixtureError({ stage: "readiness-reply" })));
      }
    };

    const onClose = () => {
      socket.off(tls === undefined ? "connect" : "secureConnect", onReady);
      socket.off("data", onData);
      socket.off("error", onError);
      resume(
        report.pipe(
          Effect.andThen(result ?? Effect.fail(new FixtureError({ stage: "readiness-closed" }))),
        ),
      );
    };

    socket.once(tls === undefined ? "connect" : "secureConnect", onReady);
    socket.on("error", onError);
    socket.on("data", onData);
    socket.once("close", onClose);

    return Effect.callback<void>((done) => {
      outcome = "interrupted";
      if (socket.closed) {
        done(report);
        return;
      }

      socket.once("close", () => done(report));
      socket.destroy();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 500,
      orElse: () => Effect.fail(new FixtureError({ stage: "readiness-timeout" })),
    }),
  );
