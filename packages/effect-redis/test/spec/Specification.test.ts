import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { loadSpecification } from "#tools/spec/Load";
import {
  ConnectionProfile,
  ProtocolProfile,
  ScenarioDefinition,
  TransportProfile,
} from "#tools/spec/Schema";
import { validateSpecification } from "#tools/spec/Validate";

it.live("SPEC-01: executable contracts and pinned fixtures are self-contained", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;

    expect(validateSpecification(spec)).toEqual([]);
  }),
);

it.live("SPEC-02: scenarios cannot refer to a fixture that was removed", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const native = spec.native.filter((fixture) => fixture.id !== "valkey");

    expect(validateSpecification({ ...spec, native })).toContain(
      "Missing scenario fixture: valkey",
    );
  }),
);

it.effect("SPEC-03: test contracts require isolation, deadlines and observable assertions", () =>
  Effect.gen(function* () {
    const scenario = {
      id: "CONFIG-01",
      family: "CONFIG",
      fixtures: ["controlled"],
      requiredCapabilities: [],
      isolation: "process",
      clock: "none",
      deadlineMillis: 5000,
      setup: "Construct synthetic configuration",
      operation: "Decode invalid credential-bearing URL",
      assertions: ["Typed failure contains no credential or URL"],
      cleanup: "No external resources acquired",
      expectedAvailability: "supported",
      expectedSemantics: "matching",
    };

    expect(yield* Schema.decodeUnknownEffect(ScenarioDefinition)(scenario)).toEqual(scenario);

    for (const invalid of [
      { ...scenario, assertions: [] },
      { ...scenario, deadlineMillis: 0 },
      { ...scenario, isolation: "shared-production" },
    ]) {
      const result = yield* Effect.result(Schema.decodeUnknownEffect(ScenarioDefinition)(invalid));

      expect(Result.isFailure(result)).toBe(true);
    }
  }),
);

it.live("SPEC-04: protocol contracts preserve the declared wire capabilities", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const protocol = yield* Schema.decodeUnknownEffect(ProtocolProfile)({
      ...spec.protocol,
      versions: ["RESP2"],
    });

    expect(validateSpecification({ ...spec, protocol })).toContain(
      "Missing protocol version: RESP3",
    );
  }),
);

it.live("SPEC-05: Node image pins cannot omit or drift from fixture versions", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;

    expect(
      validateSpecification({
        ...spec,
        nodeImages: spec.nodeImages.filter((image) => image.fixture !== "valkey"),
      }),
    ).toContain("Missing Node image: valkey");

    const first = spec.nodeImages[0];
    if (first === undefined) return yield* Effect.die("Missing primary image");

    expect(
      validateSpecification({
        ...spec,
        nodeImages: [{ ...first, image: "redis:latest" }, ...spec.nodeImages.slice(1)],
      }),
    ).toContain("Node image differs from native target: redis");
  }),
);

it.live("SPEC-06: socket contracts use a live clock and known fixture boundaries", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const first = spec.transport.scenarios[0];
    if (first === undefined) return yield* Effect.die("Missing socket contract");

    const transport = yield* Schema.decodeUnknownEffect(TransportProfile)({
      ...spec.transport,
      scenarios: [{ ...first, clock: "virtual" }, ...spec.transport.scenarios.slice(1)],
    });

    expect(validateSpecification({ ...spec, transport })).toContain(
      `Invalid transport scenario: ${first.id}`,
    );
  }),
);

it.live("SPEC-07: Testcontainers reaper and both KeyDB architectures are required", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;

    expect(
      validateSpecification({
        ...spec,
        nodeImages: spec.nodeImages.filter((image) => image.fixture !== "ryuk"),
      }),
    ).toContain("Missing Testcontainers reaper image");
    expect(
      validateSpecification({
        ...spec,
        nodeImages: spec.nodeImages.filter((image) => image.architecture !== "x64"),
      }),
    ).toContain("Missing KeyDB image architecture: x64");
  }),
);

it.live("SPEC-08: executable scenario IDs cannot be reused between contracts", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const first = spec.connection.scenarios[0];
    if (first === undefined) return yield* Effect.die("Missing connection contract");

    const connection = yield* Schema.decodeUnknownEffect(ConnectionProfile)({
      ...spec.connection,
      scenarios: [{ ...first, id: "SOCKET-01" }, ...spec.connection.scenarios.slice(1)],
    });

    expect(validateSpecification({ ...spec, connection })).toContain(
      "Duplicate executable scenario IDs",
    );
  }),
);
