import { Crypto, Effect, Layer, PlatformError, Redacted } from "effect";

const algorithms = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
} as const;

import { CryptoHasher } from "bun";

/** Native hashing plus Web Crypto entropy; no Node compatibility imports are needed. */
export const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => {
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += 65536)
        globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65536));

      return bytes;
    },
    digest: (algorithm, bytes) =>
      Effect.try({
        try: () => new Uint8Array(new CryptoHasher(algorithms[algorithm]).update(bytes).digest()),
        catch: (cause) =>
          PlatformError.systemError({
            _tag: "Unknown",
            module: "Crypto",
            method: "digest",
            cause: Redacted.make(cause),
          }),
      }),
  }),
);
