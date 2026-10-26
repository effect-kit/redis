import { expect, it } from "vitest";

import { certifyProviders } from "#test/support/providers/Evidence";
import { providerCaseId } from "#test/support/providers/Matrix";
import type { ProviderCase } from "#test/support/providers/Matrix";

const scenario: ProviderCase = {
  provider: "upstash-http",
  runtime: "node",
  protocol: "http",
  scenario: "data",
};
const id = providerCaseId(scenario);
const run = {
  runId: "current",
  artifactDigest: "a".repeat(64),
  startedAt: new Date(Date.now() - 1000).toISOString(),
  runtimeVersions: { node: "24.22.0", bun: "1.4.4" },
};
const evidence = () => ({
  runId: run.runId,
  id,
  artifactDigest: run.artifactDigest,
  configurationDigest: "b".repeat(64),
  observedAt: new Date().toISOString(),
  receipt: {
    ...scenario,
    runtimeVersion: "24.22.0",
    profile: "upstash.http",
    server: { redisVersion: "8.4.0" },
    cleanup: true,
    observations: ["data.binary-get", "data.int64", "data.strict-text"].map((observation) => ({
      id: observation,
      outcome: "passed",
    })),
  },
});

it("requires fresh complete case evidence from the same artifact and exact runtime", () => {
  expect(certifyProviders([scenario], new Map([[id, evidence()]]), run)).toHaveLength(1);
  for (const record of [
    { ...evidence(), runId: "previous" },
    { ...evidence(), artifactDigest: "c".repeat(64) },
    { ...evidence(), observedAt: "invalid" },
    { ...evidence(), observedAt: "2000-01-01T00:00:00Z" },
    { ...evidence(), receipt: { ...evidence().receipt, runtimeVersion: "24.0.0" } },
    { ...evidence(), receipt: { ...evidence().receipt, observations: [] } },
    {
      ...evidence(),
      receipt: {
        ...evidence().receipt,
        observations: [
          { id: "data.int64", outcome: "passed" },
          { id: "data.int64", outcome: "passed" },
        ],
      },
    },
  ])
    expect(() => certifyProviders([scenario], new Map([[id, record]]), run)).toThrow();

  expect(() => certifyProviders([scenario], new Map(), run)).toThrow();
  expect(() => certifyProviders([], new Map(), run)).toThrow();
});

it("rejects server drift between runtime observations instead of merging incompatible passes", () => {
  const bun: ProviderCase = { ...scenario, runtime: "bun" };
  const bunId = providerCaseId(bun);
  const second = {
    ...evidence(),
    id: bunId,
    receipt: {
      ...evidence().receipt,
      runtime: "bun",
      runtimeVersion: "1.4.4",
      server: { redisVersion: "different" },
    },
  };

  expect(() =>
    certifyProviders(
      [scenario, bun],
      new Map([
        [id, evidence()],
        [bunId, second],
      ]),
      run,
    ),
  ).toThrow();
});
