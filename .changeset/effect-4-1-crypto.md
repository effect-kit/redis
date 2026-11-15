---
"@effect-kit/redis": patch
---

Support Effect 4.1. Effect 4.1 removed the root `Crypto` module, so importing any
entrypoint of 0.1.1 with `effect@4.1` failed with
`The requested module 'effect' does not provide an export named 'Crypto'`.

Script hashing now uses the `effect/crypto` services:

- `RedisScript.make` requires `Digest.Digest` (from `effect/crypto`) instead of `Crypto.Crypto`.
- `cryptoLayer` from `@effect-kit/redis/node` and `@effect-kit/redis/bun` now provides
  native `Digest.Digest` and `SecureRandom.SecureRandom` instead of `Crypto.Crypto`.
  `RedisNode`/`RedisBun` Layers expose the same services.
- Digest failures are defects, matching the `Digest` service contract.

The `effect` peer range is now `^4.1.0`; Effect 4.0 is no longer supported because its
`effect` package has no `effect/crypto` entrypoint.
