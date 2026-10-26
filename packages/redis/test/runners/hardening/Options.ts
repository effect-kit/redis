const casePattern =
  /^(?:benchmark-(?:redis|valkey)-(?:node|bun)-(?:tcp|tls|http)|soak-(?:redis-node|valkey-bun)(?:-http)?|readiness-(?:redis|valkey|delayed))$/;

export const hardeningOptions = (args: ReadonlyArray<string>) => {
  let mode = "all";
  let calibration = false;
  const cases = new Set<string>();
  let index = 0;
  if (args[0] !== undefined && !args[0].startsWith("--")) mode = args[index++] ?? "all";
  if (!["all", "benchmark", "soak", "readiness"].includes(mode))
    throw new Error("Unknown hardening mode");
  while (index < args.length) {
    const flag = args[index++];
    if (flag === "--calibrate") calibration = true;
    else if (flag === "--case") {
      const id = args[index++];
      if (
        id === undefined ||
        !casePattern.test(id) ||
        (mode !== "all" && !id.startsWith(`${mode}-`))
      )
        throw new Error("Invalid hardening case selection");
      cases.add(id);
    } else
      throw new Error(
        "Use test:hardening [all|benchmark|soak|readiness] [--calibrate] [--case id]",
      );
  }
  return {
    mode,
    calibration,
    includes: (id: string) => cases.size === 0 || cases.has(id),
    cases: [...cases],
  };
};
