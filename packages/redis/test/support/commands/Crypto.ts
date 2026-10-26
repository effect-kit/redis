import { webcrypto } from "node:crypto";

import { Crypto, Effect, Layer } from "effect";

/** Real platform cryptography for public script descriptor consumers. */
export const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => webcrypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, bytes) =>
      Effect.promise(
        async () => new Uint8Array(await webcrypto.subtle.digest(algorithm, bytes.slice())),
      ),
  }),
);
