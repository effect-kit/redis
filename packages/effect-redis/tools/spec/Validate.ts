import type { Specification } from "#tools/spec/Schema";

/** Validate executable contracts and fixture pins without reading private plans or run history. */
export const validateSpecification = (spec: Specification): ReadonlyArray<string> => {
  const issues: Array<string> = [];

  const unique = (label: string, names: ReadonlyArray<string>) => {
    if (new Set(names).size !== names.length) issues.push(`Duplicate ${label}`);
    return new Set(names);
  };

  const requireAll = (
    label: string,
    required: ReadonlyArray<string>,
    actual: ReadonlySet<string>,
  ) => {
    for (const name of required) if (!actual.has(name)) issues.push(`Missing ${label}: ${name}`);
  };

  const native = unique(
    "native fixture IDs",
    spec.native.map((fixture) => fixture.id),
  );
  unique(
    "Node image fixtures",
    spec.nodeImages.map((image) => `${image.fixture}:${image.architecture ?? "multi"}`),
  );

  for (const fixture of spec.native) {
    if (!spec.nodeImages.some((image) => image.fixture === fixture.id))
      issues.push(`Missing Node image: ${fixture.id}`);
  }

  for (const image of spec.nodeImages) {
    const fixture = spec.native.find((target) => target.id === image.fixture);
    const version =
      fixture?.version.replace(/^v/, "") ?? (image.fixture === "ryuk" ? "0.14.0" : undefined);
    const suffix =
      image.fixture === "keydb"
        ? `:${image.architecture === "arm64" ? "arm64" : "x86_64"}_v${version}`
        : `:${image.fixture === "dragonfly" ? "v" : ""}${version}${image.variant === undefined ? "" : `-${image.variant}`}`;

    if (version === undefined || image.version !== version || !image.image.endsWith(suffix))
      issues.push(`Node image differs from native target: ${image.fixture}`);

    if (
      fixture?.kind === "engine" &&
      image.moduleList !== "unsupported" &&
      image.modules === undefined
    )
      issues.push(`Missing Node fixture module inventory: ${image.fixture}`);
  }

  for (const architecture of ["arm64", "x64"]) {
    if (
      !spec.nodeImages.some(
        (image) => image.fixture === "keydb" && image.architecture === architecture,
      )
    )
      issues.push(`Missing KeyDB image architecture: ${architecture}`);
  }

  if (!spec.nodeImages.some((image) => image.fixture === "ryuk"))
    issues.push("Missing Testcontainers reaper image");

  if (spec.native.find((fixture) => fixture.id === "node")?.version !== spec.transport.baseline)
    issues.push("Node transport baseline differs from native runtime");

  requireAll("protocol version", ["RESP2", "RESP3"], new Set(spec.protocol.versions));
  requireAll(
    "streamed encoding",
    ["blob-string", "array", "map", "set"],
    new Set(spec.protocol.streamed),
  );

  const profiles = [
    { profile: spec.protocol, fixtures: new Set([spec.protocol.fixtureId]) },
    { profile: spec.transport, fixtures: new Set([...native, "node-loopback", "node-tls"]) },
    { profile: spec.connection, fixtures: new Set([...native, spec.connection.fixtureId]) },
    { profile: spec.commandSystem, fixtures: new Set([...native, spec.commandSystem.fixtureId]) },
  ];

  unique(
    "executable scenario IDs",
    profiles.flatMap(({ profile }) => profile.scenarios.map((scenario) => scenario.id)),
  );

  for (const { profile, fixtures } of profiles) {
    for (const scenario of profile.scenarios)
      requireAll("scenario fixture", scenario.fixtures, fixtures);
  }

  for (const scenario of spec.transport.scenarios) {
    if (scenario.family !== "SOCKET" || scenario.clock !== "live")
      issues.push(`Invalid transport scenario: ${scenario.id}`);
  }

  unique(
    "descriptor names",
    spec.descriptors.map((descriptor) => descriptor.name),
  );
  if (spec.descriptors.length !== spec.commandSystem.descriptorCount)
    issues.push("Descriptor inventory count mismatch");

  const commandIds = new Set(spec.commandSystem.scenarios.map((scenario) => scenario.id));
  for (const descriptor of spec.descriptors)
    requireAll("descriptor scenario", descriptor.scenarios, commandIds);

  return issues;
};
