import { selectedEngine, serverTargets } from "#test/support/servers/Targets";

export const bunTargets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.fixture) &&
    (selectedEngine === "all" || selectedEngine === target.product),
);

export const bunCases = bunTargets.flatMap((target) =>
  ["resp2", "resp3"].map((protocol) => ({ target, protocol })),
);
