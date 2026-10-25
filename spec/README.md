# Executable development contracts

Keep only inputs used by current tests and tooling here. These files describe
expected behavior and reproducible fixtures; they do not record implementation
phases, progress, local test runs or certification status.

- `protocol.json`, `transport.json`, `connection.json` and `command-system.json`
  define scenario IDs, fixture boundaries, setup, assertions and cleanup contracts.
- `command-system/` contains independently reviewed descriptor expectations, grouped
  by family. Tests compare them with production metadata and check scenario links.
- `fixtures/native.json` pins the server/runtime versions used by live tests.
- `fixtures/node-images.json` pins Docker digests, architecture variants and actual
  module configurations. Run `pnpm fixtures:pull` before live container tests.

Run `pnpm check:spec` to validate these inputs and `pnpm test` to run their contract
checks. Run `pnpm test:live` for real socket/server behavior. A valid contract is not
proof that a backend supports it; live results belong to the executed test reports.

Research catalogs, future backend/release plans, phase ownership, compatibility
tracking and historical run evidence live in ignored `research/`. Builds, tests,
CI and package archives must not read that directory.
