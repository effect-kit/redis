import { it } from "@effect/vitest";

import { providerCase } from "#test/support/providers/Case";
import { selectedProviderCases } from "#test/support/providers/Matrix";

const cases = selectedProviderCases().filter((scenario) => scenario.scenario === "native");
if (cases.length > 0)
  it.live.each(cases)(
    "PROVIDER: $provider $runtime $protocol native ownership and values",
    (scenario) => providerCase(scenario),
    120_000,
  );
