import { Effect } from "effect";

import { loadSpecification, SpecificationError } from "#tools/spec/Load";
import { validateSpecification } from "#tools/spec/Validate";

const check = Effect.gen(function* () {
  const spec = yield* loadSpecification;
  const issues = validateSpecification(spec);

  if (issues.length > 0)
    return yield* new SpecificationError({ file: "spec", reason: issues.join("; ") });

  return {
    protocolScenarios: spec.protocol.scenarios.length,
    transportScenarios: spec.transport.scenarios.length,
    connectionScenarios: spec.connection.scenarios.length,
    commandSystemScenarios: spec.commandSystem.scenarios.length,
    descriptors: spec.descriptors.length,
    nativeFixtures: spec.native.length,
    nodeImages: spec.nodeImages.length,
  };
});

Effect.runPromise(check).then(
  (summary) => process.stdout.write(`${JSON.stringify(summary)}\n`),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
