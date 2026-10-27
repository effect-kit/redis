# Releases

Run `pnpm changeset` for public changes and commit the generated file with your code.
Choose patch for fixes, minor for new features, or major for breaking changes.

Dispatch **Release** on `main` with `dry-run` disabled to create or update the version/changelog PR.
Review and merge it, then dispatch again with `dry-run` disabled to publish the exact package
archive through npm trusted publishing with provenance.

The default `dry-run` mode creates temporary versions in the runner and verifies archives
without opening a PR, tagging, or publishing. `release:version` updates versions/changelogs;
`version-packages` remains a compatibility alias target.

PR CI runs `ci:check`; release preparation runs the independently configurable
`release:prepare`. Both currently use the fast `check` gate. **Extended tests** owns
protocol fuzzing and repeated artifact builds. Backend conformance has its own manual workflow.
`release:check` verifies the exact archive once, using offline Node/Bun consumers and no live servers.

Publication does not wait for registry availability. Run `pnpm release:smoke` with
the verified archive separately after npm makes the version available, or dispatch **Release smoke**
with the successful release run and packed artifact IDs shown in the release summary.
Archives from verification-only runs were not published and cannot pass registry smoke checks.

Releases are manual. Keep the generated archive unchanged after verification.
