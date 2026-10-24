# effect-redis

A runtime-neutral Redis client foundation for Effect v4. The package remains private.
The public API includes configuration decoding, binary `encodeCommand`, incremental
`makeRespDecoder`, lossless `RespValue`/`RespPairs`, `RedisArgument`/`RedisCommand`,
codec limits and typed errors. Network connections and command execution arrive
in later phases.

See the [RESP codec](../../docs/architecture/protocol.md) for grammar, streamed forms,
Result/Effect composition, EOF/error handling and byte limits.
See the [foundation contract](../../docs/architecture/foundation.md) for endpoint
shapes, redaction, TLS/options validation, defaults and the internal scoped transport
boundary. [Release specifications](../../spec/README.md) track planned coverage;
their presence is not conformance evidence.

Only Effect is a runtime peer dependency. Universal exports have no Node/Bun imports.
Builds use tsdown/Klarity, TypeScript 7 declarations and Publint. Tests, tools and
specifications stay outside the package artifact.

Run from the workspace root:

- `pnpm --filter effect-redis test` (or `test:unit`): offline Vitest/Effect tests.
- `pnpm --filter effect-redis typecheck`: source, test and tool configurations.
- `pnpm --filter effect-redis lint`: source, tests, support and tooling.
- `pnpm --filter effect-redis build`: unbundled ESM/declarations plus Publint.
- `pnpm test:protocol:fuzz`: built-artifact fuzz/large-input corpus under an external watchdog.
- `pnpm check:spec`: tracked inventory/fixture/scenario validation.
- `pnpm check`: the complete workspace checks.

Tests require no Redis process, credentials or network access. Real server/provider
lanes will be added with their owning phases; no empty integration job counts as a
pass. See [implementation progress](../../docs/progress/README.md).
