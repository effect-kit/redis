import { it } from "@effect/vitest";

import { providerCase } from "#test/support/providers/Case";
import { selectedProviderCases } from "#test/support/providers/Matrix";

const cases = selectedProviderCases().filter((scenario) => scenario.provider === "upstash-http");
if (cases.length > 0)
  it.live.each(cases)(
    "PROVIDER: hosted Upstash $runtime $scenario",
    (scenario) => providerCase(scenario),
    120_000,
  );
