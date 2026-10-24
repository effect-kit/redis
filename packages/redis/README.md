# effect-redis

The runtime-neutral client package for Effect v4. This is the initial workspace scaffold;
Only the binary-safe `RedisArgument` type is exported; commands and connections are
not implemented yet. The package stays private until
the first release is ready.

Only Effect may be a runtime peer dependency. Protocol, command, and connection modules
will live here. Runtime-specific socket adapters will use separate subpath exports or
workspace packages when their ownership requires it.

Use `pnpm --filter effect-redis build`, `typecheck`, `lint`, or `test` from the root.
The build uses tsdown with `klarity/tsdown/library` for unbundled ESM, TypeScript 7
declarations, and Publint validation. Tests use
Node's built-in runner; the initial scaffold has no behavior tests.
