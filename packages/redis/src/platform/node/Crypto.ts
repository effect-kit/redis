import { createHash, randomBytes } from "node:crypto";

import { Effect, Layer } from "effect";
import { Digest, SecureRandom } from "effect/crypto";

const digestBytes = (algorithm: Digest.Algorithm, bytes: Uint8Array) =>
  new Uint8Array(createHash(algorithm.name.replace("-", "").toLowerCase()).update(bytes).digest());

/** Optional platform services for RedisScript.make; ordinary Redis connections do not require them. */
export const cryptoLayer: Layer.Layer<Digest.Digest | SecureRandom.SecureRandom> = Layer.mergeAll(
  Layer.succeed(Digest.Digest, {
    // Digest has no error channel; a native hashing failure is a defect.
    digest: (algorithm, bytes) => Effect.sync(() => digestBytes(algorithm, bytes)),
    digestHex: (algorithm, bytes) =>
      Effect.sync(() => Buffer.from(digestBytes(algorithm, bytes)).toString("hex")),
  }),
  Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(randomBytes)),
);
