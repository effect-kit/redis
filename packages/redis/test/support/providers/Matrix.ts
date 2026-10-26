import { Schema } from "effect";

import { HttpScenario, Provider } from "#test/support/providers/Contract";
import type { Provider as ProviderId } from "#test/support/providers/Contract";
import { ProviderTestError } from "#test/support/providers/Failures";

export interface ProviderCase {
  readonly provider: ProviderId;
  readonly runtime: "node" | "bun" | "deno" | "workers";
  readonly protocol: "resp2" | "resp3" | "http";
  readonly scenario: "native" | typeof HttpScenario.Type;
}

export const providerCases = (provider = "all", runtime = "all"): ReadonlyArray<ProviderCase> => {
  const selectedRuntime = Schema.decodeUnknownSync(Schema.Literals(["all", "node", "bun", "deno"]))(
    runtime,
  );
  const providers =
    provider === "all" ? Provider.literals : [Schema.decodeUnknownSync(Provider)(provider)];
  const cases: ProviderCase[] = [];

  for (const selected of providers) {
    if (selected === "workers") {
      for (const scenario of HttpScenario.literals)
        cases.push({ provider: selected, runtime: "workers", protocol: "http", scenario });
      continue;
    }
    const runtimes =
      selectedRuntime === "all" ? (["node", "bun", "deno"] as const) : ([selectedRuntime] as const);
    for (const host of runtimes) {
      if (selected === "upstash-http") {
        for (const scenario of HttpScenario.literals)
          cases.push({ provider: selected, runtime: host, protocol: "http", scenario });
      } else if (host !== "deno") {
        for (const protocol of ["resp2", "resp3"] as const)
          cases.push({ provider: selected, runtime: host, protocol, scenario: "native" });
      }
    }
  }
  if (cases.length === 0)
    throw new ProviderTestError({
      stage: "selection",
      reason: "No applicable provider/runtime cases",
    });
  return cases;
};

export const providerCaseId = (scenario: ProviderCase) =>
  `${scenario.provider}-${scenario.runtime}-${scenario.protocol}-${scenario.scenario}`;

export const selectedProviderCases = () => {
  const cases = providerCases(
    process.env.EFFECT_REDIS_PROVIDER_SELECTION,
    process.env.EFFECT_REDIS_PROVIDER_RUNTIME,
  );
  const ids: ReadonlyArray<string> = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    JSON.parse(process.env.EFFECT_REDIS_PROVIDER_CASES ?? "[]"),
  );
  return ids.length === 0
    ? cases
    : cases.filter((scenario) => ids.includes(providerCaseId(scenario)));
};
