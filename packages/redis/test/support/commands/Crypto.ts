import { webcrypto } from "node:crypto";

import { Layer } from "effect";
import { Digest, SecureRandom, WebCrypto } from "effect/crypto";

/** Real platform cryptography for public script descriptor consumers. */
export const cryptoLayer = Layer.mergeAll(Digest.layerWebCrypto, SecureRandom.layerWebCrypto).pipe(
  Layer.provide(WebCrypto.layer(webcrypto as Crypto)),
);
