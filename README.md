# Effect Redis

**Redis for Effect v4.** A native, typed Redis client with scoped connections,
transactions, Streams and Pub/Sub across Node.js, Bun and Upstash HTTP.

The npm package is [`@effect-kit/redis`](https://www.npmjs.com/package/@effect-kit/redis).
Effect is the only runtime peer dependency; the client implements RESP directly
using platform sockets and Effect HTTP.

```sh
pnpm add @effect-kit/redis effect
```

```ts
import { Effect } from "effect";

import { Redis } from "@effect-kit/redis";
import { RedisNode } from "@effect-kit/redis/node";

const RedisLive = RedisNode.layer({ url: "redis://localhost:6379" });

const program = Effect.gen(function* () {
  const redis = yield* Redis;

  yield* redis.set("greeting", "Hello from Effect");

  return yield* redis.get("greeting");
});

const greeting = await Effect.runPromise(program.pipe(Effect.provide(RedisLive)));
```

See the **[package README](packages/redis/README.md)** for installation, configuration,
typed payloads, pipelines, transactions, scans, Pub/Sub and topology examples.

## What it provides

- Typed commands with binary values, exact integers and explicit Schema codecs.
- Scoped Node/Bun TCP, TLS and Unix sockets with bounded queues and backpressure.
- Pipelines, transactions, WATCH, blocking sessions, scripting and functions.
- Lazy scans, Redis Streams/group recovery, Pub/Sub, tracking and bounded caches.
- Redis/Valkey Cluster routing and Sentinel discovery without uncertain-write replay.
- Upstash HTTP/SSE and separate provider Search/Vector/ACL command families.
- Optional JSON, Search, TimeSeries, probabilistic and vector-set module commands.
- Effect Layers, tagged errors, credential refresh and opt-in telemetry.

Redis and Valkey are the primary native backends. Tests also exercise Dragonfly,
KeyDB, Redict, Garnet and Apache Kvrocks with explicit unsupported/different outcomes.
Hosted tests cover isolated Upstash, Aiven Valkey and Redis Cloud Free configurations,
plus HTTP on Deno and Cloudflare Workers. Compatibility is scoped to actual tested
versions, configurations and operations; backend policies do not certify every
deployment of a service.

## Development

Use Node.js **24.22.0+**, pnpm **12.14.0** and Bun **1.4.4**, pinned in the repository.

```sh
pnpm install --frozen-lockfile
pnpm ci:check
```

See [.env.example](.env.example) for application and optional provider-test settings.
Default tests need no env file; hosted tests load only the file passed through
`--credentials-file`.

The pnpm/Turborepo workspace uses TypeScript 7, tsdown, Klarity, Oxfmt, Oxlint,
Lefthook and Commitlint. Shared dependency ranges live in the pnpm catalog;
the lockfile records exact tool and runtime versions.

| Command                                                       | Purpose                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm check`                                                  | Format, lint, typecheck, offline tests and build               |
| `pnpm ci:check`                                               | Fast PR/main gate; runs `check`                                |
| `pnpm release:prepare`                                        | Fast release checks and build                                  |
| `pnpm release:version`                                        | Update package versions, changelogs and lockfile               |
| `pnpm test:extended`                                          | Manual fixture checks, fuzzing and full artifact suite         |
| `pnpm test`                                                   | Unit and controlled integration tests; no Redis or credentials |
| `pnpm test:protocol:fuzz`                                     | Built-artifact RESP fuzz and large-input corpus                |
| `pnpm test:artifacts`                                         | Three deterministic builds and exact packed consumers          |
| `pnpm fixtures:check`                                         | Validate pinned backend fixtures                               |
| `pnpm fixtures:pull`                                          | Explicitly prepare container images                            |
| `pnpm test:live`                                              | Native/backend integration and e2e suites                      |
| `pnpm verify`                                                 | Offline checks, fixture validation, fuzz and all live suites   |
| `pnpm dev:upstash`                                            | Start an owned local HTTP fixture until Ctrl+C                 |
| `pnpm test:hardening`                                         | Disposable benchmarks, soaks and readiness checks              |
| `pnpm test:providers --credentials-file .env.providers.local` | Opt-in hosted tests                                            |
| `pnpm changeset`                                              | Describe a public change for the next release                  |

Live suites require Docker, OpenSSL and explicitly prepared images. Runtime and
engine selection are independent:

```sh
pnpm fixtures:pull
pnpm test:live --engine valkey --runtime node
pnpm test:bun --engine redis
pnpm test:upstash
```

For read-only checks against an existing server, set `EFFECT_REDIS_TEST_URL`
privately and run `pnpm test:live --mode endpoint`. This mode performs connection
authentication and PING/ECHO only. Mutating tests own disposable fixtures.

The [test guide](packages/redis/test/README.md) describes suite organization and
fixtures. Do not rebuild a checkout while live probes are reading its artifacts.

Fast offline CI runs on ordinary PRs and pushes to `main`; bot-created Changesets version
PRs skip the CI job until merged. **Extended tests** runs fixture validation, protocol fuzzing,
and the three-build artifact suite only through manual dispatch. Live conformance,
hosted-provider and release workflows are also dispatch-only. Live dispatch can select an
engine and an optional PR number; it tests the exact resolved commit. Hardening
checks remain available locally through `pnpm test:hardening`.

## Releases

CI, PR-title checks, Changeset summaries, releases, and registry smoke checks reuse
[EffectKit's shared workflows](https://github.com/effect-kit/.github). Runtime versions
and package-specific checks stay in this repository's scripts.

Changesets manages package versions and changelogs. Add a Changeset with public API
changes, commit it with the code, and dispatch **Release** on `main` with `dry-run` disabled
to create or update the version PR. After reviewing and merging that PR, dispatch **Release**
again with `dry-run` disabled to publish the verified package with npm trusted publishing and
provenance. See [the release guide](.changeset/README.md).

The default `dry-run` mode verifies temporary versions and archives without opening a PR
or publishing. Release runs `release:prepare` and verifies the exact archive with
`release:check`, including types, README examples, and Node/Bun consumers without live servers.
Full backend conformance stays in the manual live workflow. **Release smoke** separately
checks the published registry archive and provenance after npm makes it available.

Release automation never publishes on a PR or ordinary push. npm organization
membership and trusted-publisher configuration are maintained by package owners.

## Contributing

Keep modules focused, use Effect-native services/tests and preserve binary and
connection-lifetime contracts. The [agent guide](AGENTS.md) records engineering
conventions. Use Conventional Commits and include tests for behavior changes.

Open [issues](https://github.com/effect-kit/redis/issues) for bugs and proposals.
For vulnerabilities, use private reporting from the repository's Security tab when
available; keep credentials and exploit details out of public issues.

## License

[Apache-2.0](LICENSE) · Copyright 2026 Effect Kit Contributors.
