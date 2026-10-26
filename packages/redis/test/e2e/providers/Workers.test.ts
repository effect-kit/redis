import { layer } from "@effect/vitest";
import { Effect } from "effect";

import { providerCase } from "#test/support/providers/Case";
import { selectedProviderCases } from "#test/support/providers/Matrix";
import { HostedWorker } from "#test/support/providers/workers/Fixture";

const cases = selectedProviderCases().filter((scenario) => scenario.provider === "workers");
if (cases.length > 0)
  layer(HostedWorker.layer, { excludeTestServices: true, timeout: "120 seconds" })(
    "Hosted Workers HTTP runtime",
    (it) =>
      it.effect.each(cases)(
        "PROVIDER: Workers $scenario",
        (scenario) =>
          Effect.gen(function* () {
            const worker = yield* HostedWorker;
            return yield* providerCase(scenario, worker.invoke);
          }),
        120_000,
      ),
  );
