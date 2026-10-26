import { Effect, Redacted, Schema } from "effect";

import type { RuntimeInput } from "#test/support/runtime/bun/Input";
import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { FixtureError } from "#test/support/servers/FixtureError";
import { bunRuntimeImage, bunRuntimeRevision } from "#test/support/servers/Targets";

const Receipt = Schema.Struct({
  bun: Schema.Literal(bunRuntimeImage.version),
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  platform: Schema.NonEmptyString,
  architecture: Schema.NonEmptyString,
  scenario: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(Schema.NonEmptyString),
});

export const readBunReceipt = Effect.fnUntraced(function* (output: string, scenario: string) {
  const receipt = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Receipt)(JSON.parse(output)),
    catch: (cause) =>
      new FixtureError({ stage: "bun-runtime-receipt", cause: Redacted.make(cause) }),
  });

  if (receipt.scenario !== scenario)
    return yield* new FixtureError({ stage: "bun-runtime-scenario" });
  if (receipt.revision !== bunRuntimeRevision)
    return yield* new FixtureError({ stage: "bun-runtime-revision" });

  return receipt;
});

/** One actual Bun process per scenario, with bounded output and awaited cancellation. */
export const runBun = Effect.fnUntraced(function* (input: RuntimeInput, timeout = 30_000) {
  const output = yield* runRuntimeProgram({
    runtime: "bun",
    program: new URL("../../../runners/bun/main.ts", import.meta.url),
    input: JSON.stringify(input),
    timeout,
    stage: "bun-runtime",
  });

  return yield* readBunReceipt(output, input.scenario);
});
