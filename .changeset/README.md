# Releases

Run `pnpm changeset` for public changes and commit the generated file with your code.
Choose patch for fixes, minor for new features, or major for breaking changes.

Dispatch **Release** on `main` to create or update the version/changelog PR.
Review and merge it, then dispatch again to validate and publish the exact package
archive through npm trusted publishing with provenance.

Releases are manual. Keep the generated archive unchanged after verification.
