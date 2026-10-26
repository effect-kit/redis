import { createHash, randomBytes } from "node:crypto";

import { Crypto, Effect, Layer, PlatformError, Redacted } from "effect";

/** Optional platform service for RedisScript.make; ordinary Redis connections do not require it. */
export const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes,
    digest: (algorithm, bytes) =>
      Effect.try({
        try: () => new Uint8Array(createHash(algorithm.replace("-", "")).update(bytes).digest()),
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
