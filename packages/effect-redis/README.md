# @envoy1084/effect-redis

A runtime-neutral Redis client foundation for Effect v4. The package remains private.
The public API includes configuration decoding, binary `encodeCommand`, incremental
`makeRespDecoder`, lossless `RespValue`/`RespPairs`, `RedisArgument`/`RedisCommand`,
codec limits and typed errors. Network connections and command execution arrive
in later phases.

The codecs return Effect Result; use Effect.fromResult to compose them into Effects.
Feed bounded byte chunks, drain decoder.next() between feeds, and drain after end()
to detect truncated input. Detailed architecture notes and progress reports stay in
ignored local research. [Release specifications](../../spec/README.md) track planned
coverage; their presence is not conformance evidence.

Effect `^4.0.6` is the only runtime peer dependency. Universal exports have no Node/Bun imports.
Builds use tsdown/Klarity, TypeScript 7 declarations and Publint. Tests, tools and
specifications stay outside the package artifact.

Run from the workspace root:

- `pnpm --filter @envoy1084/effect-redis test` (or `test:unit`): offline Vitest/Effect tests.
- `pnpm --filter @envoy1084/effect-redis typecheck`: source, test and tool configurations.
- `pnpm --filter @envoy1084/effect-redis lint`: source, tests, support and tooling.
- `pnpm --filter @envoy1084/effect-redis build`: unbundled ESM/declarations plus Publint.
- `pnpm test:protocol:fuzz`: built-artifact fuzz/large-input corpus under an external watchdog.
- `pnpm check:spec`: tracked inventory/fixture/scenario validation.
- `pnpm check`: the complete workspace checks.

Tests require no Redis process, credentials or network access. Real server/provider
lanes will be added with their owning phases; no empty integration job counts as a
pass.

Licensed under Apache-2.0. Package archives include the license and built artifacts;
`prepack` rebuilds them, and pnpm replaces catalog references with compatible ranges.
