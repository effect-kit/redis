import { Effect } from "effect";

import { loadSpecification, SpecificationError } from "./spec/Load.ts";
import { validateSpecification } from "./spec/Validate.ts";

const check = Effect.gen(function* () {
  const spec = yield* loadSpecification;
  const issues = validateSpecification(spec);
  if (issues.length > 0)
    return yield* new SpecificationError({ file: "spec", reason: issues.join("; ") });
  return {
    protocolScenarios: spec.protocol.scenarios.length,
    commands: spec.commands.length,
    categories: spec.index.categories.length,
    nativeFixtures: spec.native.length,
    hostedConfigurations: spec.hosted.length,
    runtimePairs: spec.runtimePairs.length,
    scenarioFamilies: spec.scenarios.length,
  };
});

Effect.runPromise(check).then(
  (summary) => process.stdout.write(`${JSON.stringify(summary)}\n`),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
