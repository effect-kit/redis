import { Effect, Layer } from "effect";
import { Digest, SecureRandom } from "effect/crypto";

import { CryptoHasher } from "bun";

const algorithms = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
} as const;

const hasher = (algorithm: Digest.Algorithm, bytes: Uint8Array) =>
  new CryptoHasher(algorithms[algorithm.name]).update(bytes);

/** Native hashing plus Web Crypto entropy; no Node compatibility imports are needed. */
export const cryptoLayer: Layer.Layer<Digest.Digest | SecureRandom.SecureRandom> = Layer.mergeAll(
  Layer.succeed(Digest.Digest, {
    // Digest has no error channel; a native hashing failure is a defect.
    digest: (algorithm, bytes) =>
      Effect.sync(() => new Uint8Array(hasher(algorithm, bytes).digest())),
    digestHex: (algorithm, bytes) => Effect.sync(() => hasher(algorithm, bytes).digest("hex")),
  }),
  // getRandomValues rejects requests above 65,536 bytes; SecureRandom.make checks sizes first.
  Layer.succeed(
    SecureRandom.SecureRandom,
    SecureRandom.make((size) => {
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += 65536)
        globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65536));

      return bytes;
    }),
  ),
);
