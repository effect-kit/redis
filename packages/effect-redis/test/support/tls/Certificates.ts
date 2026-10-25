import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted } from "effect";

import { command } from "#test/support/servers/Command";
import { FixtureError } from "#test/support/servers/FixtureError";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";

/** Ephemeral test identities, never repository fixtures or package assets. */
export const certificates = Effect.fnUntraced(function* () {
  const directory = yield* temporaryDirectory;
  const path = (name: string) => join(directory, name);
  yield* command("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "1",
    "-subj",
    "/CN=Effect Redis test CA",
    "-keyout",
    path("ca.key"),
    "-out",
    path("ca.crt"),
  ]);
  for (const name of ["server", "client"] as const) {
    const extension =
      name === "server"
        ? "subjectAltName=DNS:redis.test,DNS:localhost\nextendedKeyUsage=serverAuth\n"
        : "extendedKeyUsage=clientAuth\n";
    yield* Effect.tryPromise({
      try: () => writeFile(path(`${name}.ext`), extension),
      catch: (cause) =>
        new FixtureError({ stage: "certificate-extension", cause: Redacted.make(cause) }),
    });
    yield* command("openssl", [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${name === "server" ? "redis.test" : "test-client"}`,
      "-keyout",
      path(`${name}.key`),
      "-out",
      path(`${name}.csr`),
    ]);
    yield* command("openssl", [
      "x509",
      "-req",
      "-sha256",
      "-days",
      "1",
      "-in",
      path(`${name}.csr`),
      "-CA",
      path("ca.crt"),
      "-CAkey",
      path("ca.key"),
      "-CAcreateserial",
      "-extfile",
      path(`${name}.ext`),
      "-out",
      path(`${name}.crt`),
    ]);
  }
  const read = (name: string) =>
    Effect.tryPromise({
      try: () => readFile(path(name), "utf8"),
      catch: (cause) =>
        new FixtureError({ stage: "certificate-read", cause: Redacted.make(cause) }),
    });
  return {
    directory,
    ca: yield* read("ca.crt"),
    serverCertificate: yield* read("server.crt"),
    serverKey: Redacted.make(yield* read("server.key")),
    clientCertificate: yield* read("client.crt"),
    clientKey: Redacted.make(yield* read("client.key")),
  };
});
export type Certificates = Effect.Success<ReturnType<typeof certificates>>;
