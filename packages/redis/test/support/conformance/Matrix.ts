import type { Domain } from "#test/support/conformance/Contract";
import { regularDomains } from "#test/support/conformance/Domains";
import { selectRuntime } from "#test/support/runtime/Selection";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";

const selected = selectRuntime(process.env.EFFECT_REDIS_TEST_RUNTIME);
const runtimes: ReadonlyArray<"node" | "bun"> = selected === "all" ? ["node", "bun"] : [selected];
const targets = serverTargets.filter(
  (target) =>
    target.fixture === target.product &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

export const casesFor = (domain: Domain, execution: "host" | "linux" = "host") =>
  targets
    .filter((target) => domain !== "garnet-lua" || target.product === "garnet")
    .flatMap((target) =>
      (["resp2", "resp3"] as const).flatMap((protocol) =>
        runtimes.map((runtime) => ({ target, protocol, runtime, domain, execution })),
      ),
    );

export type EngineCase = ReturnType<typeof casesFor>[number];
export const caseId = ({ target, protocol, runtime, domain, execution }: EngineCase) =>
  `engine-${target.fixture}-${protocol}-${runtime}-${domain}-${execution}`;

/** These are the actual registered test selections, including independently enabled configuration profiles. */
export const requiredCases = () => [
  ...regularDomains.flatMap((domain) => casesFor(domain)),
  ...casesFor("all", "linux"),
  ...casesFor("garnet-lua"),
  ...casesFor("garnet-lua", "linux"),
];
