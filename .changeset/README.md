# Releases

Run `pnpm changeset` for public changes and commit the generated file with your code.
Choose patch for fixes, minor for new features, or major for breaking changes.

Dispatch **Release** on `main` to create or update the version/changelog PR.
Review and merge it, then dispatch again to validate and publish the exact package
archive through npm trusted publishing with provenance.

Release runs fast offline and package checks. Backend conformance has its own
manual workflow. CI runs the full artifact suite; Release verifies the exact
archive being published.

Publication does not wait for registry availability. Run `pnpm release:smoke` with
the verified archive separately after npm makes the version available.

Releases are manual. Keep the generated archive unchanged after verification.
