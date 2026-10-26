import { Effect, Schema } from "effect";

import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { selectRuntime } from "#test/support/runtime/Selection";
import { FixtureError } from "#test/support/servers/FixtureError";
import { bunRuntimeImage, bunRuntimeRevision } from "#test/support/servers/Targets";

const Receipt = Schema.Struct({
  runtime: Schema.Literals(["node", "bun"]),
  version: Schema.NonEmptyString,
  revision: Schema.optionalKey(Schema.NonEmptyString),
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const selected = selectRuntime(process.env.EFFECT_REDIS_TEST_RUNTIME);
export const httpRuntimes = (["node", "bun"] as const).filter(
  (runtime) => selected === "all" || selected === runtime,
);

export const runHttpRuntime = Effect.fnUntraced(function* (
  runtime: "node" | "bun",
  input: { readonly url: string; readonly token: string; readonly prefix: string },
) {
  const output = yield* runRuntimeProgram({
    runtime,
    program: new URL("../../runners/upstash/Runtime.ts", import.meta.url),
    input: JSON.stringify(input),
    timeout: 30_000,
    stage: "http-runtime",
  });
  const receipt = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Receipt, { onExcessProperty: "error" })(JSON.parse(output)),
    catch: () => new FixtureError({ stage: "http-runtime-receipt" }),
  });
  if (
    receipt.runtime !== runtime ||
    receipt.version !== (runtime === "bun" ? bunRuntimeImage.version : process.versions.node) ||
    (runtime === "bun" && receipt.revision !== bunRuntimeRevision)
  )
    return yield* new FixtureError({ stage: "http-runtime-version" });

  for (const check of ["binary", "int64", "Schema", "batches", "Streams", "SSE", "provider-errors"])
    if (!receipt.checks.includes(check))
      return yield* new FixtureError({ stage: "http-runtime-checks" });
  return receipt;
});
