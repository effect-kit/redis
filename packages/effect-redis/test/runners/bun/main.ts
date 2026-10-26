import { Effect, Schema } from "effect";

import { native } from "#test/runners/bun/Runtime";
import { transport } from "#test/runners/bun/Transport";
import { RuntimeInput } from "#test/support/runtime/bun/Input";

const program = Effect.gen(function* () {
  const text = yield* Effect.promise(() => Bun.stdin.text());
  const input = yield* Effect.try({
    try: () => {
      if (text.length > 65536) throw new Error("Input limit");
      return Schema.decodeUnknownSync(RuntimeInput)(JSON.parse(text));
    },
    catch: () => new Error("Invalid Bun scenario input"),
  });
  const checks = yield* transport(input);

  return {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    scenario: input.scenario,
    checks,
  };
}).pipe(Effect.provide(native.layer));

await Effect.runPromise(Effect.scoped(program)).then(
  (receipt) => console.log(JSON.stringify(receipt)),
  (error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  },
);
