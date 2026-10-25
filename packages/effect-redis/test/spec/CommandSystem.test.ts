import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { pingMetadata } from "../../src/commands/connection/Ping.js";
import { zscoreMetadata } from "../../src/commands/sorted-sets/Zscore.js";
import { getMetadata } from "../../src/commands/strings/Get.js";
import { incrMetadata } from "../../src/commands/strings/Incr.js";
import { setMetadata } from "../../src/commands/strings/Set.js";
import { loadSpecification } from "../../tools/spec/Load.ts";
import { CommandSystemProfile, Descriptor } from "../../tools/spec/Schema.ts";
import { validateSpecification } from "../../tools/spec/Validate.ts";

const byName = (a: typeof Descriptor.Type, b: typeof Descriptor.Type) =>
  a.name.localeCompare(b.name);

it.live(
  "SPEC-13: reviewed family catalogs match production descriptor provenance and scenarios",
  () =>
    Effect.gen(function* () {
      const spec = yield* loadSpecification;
      const production = [pingMetadata, getMetadata, incrMetadata, setMetadata, zscoreMetadata];
      expect(spec.descriptors.toSorted(byName)).toEqual(production.toSorted(byName));
      expect(
        spec.commands
          .filter((command) => command.implementation === "partial")
          .map((command) => command.name)
          .toSorted(),
      ).toEqual(production.map((command) => command.name).toSorted());
      expect(validateSpecification(spec)).toEqual([]);
    }),
);
it.live("SPEC-14: command-system ownership, scenario links and partial coverage cannot drift", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const first = spec.commandSystem.scenarios[0];
    const descriptor = spec.descriptors[0];
    if (first === undefined || descriptor === undefined)
      return yield* Effect.die("Missing command slice specification");
    const commandSystem = yield* Schema.decodeUnknownEffect(CommandSystemProfile)({
      ...spec.commandSystem,
      scenarios: [{ ...first, ownerPhase: 6 }, ...spec.commandSystem.scenarios.slice(1)],
    });
    expect(validateSpecification({ ...spec, commandSystem })).toContain(
      `Wrong command-system scenario owner: ${first.id}`,
    );
    const broken = yield* Schema.decodeUnknownEffect(Descriptor)({
      ...descriptor,
      scenarios: ["COMMAND-INVENTED"],
    });
    expect(
      validateSpecification({ ...spec, descriptors: [broken, ...spec.descriptors.slice(1)] }),
    ).toContain("Missing descriptor scenario: COMMAND-INVENTED");
    expect(validateSpecification({ ...spec, descriptors: spec.descriptors.slice(1) })).toContain(
      "Descriptor inventory count mismatch",
    );
    expect(validateSpecification({ ...spec, descriptors: spec.descriptors.slice(1) })).toContain(
      `Partial command lacks a reviewed descriptor: ${descriptor.name}`,
    );
  }),
);
it.live(
  "SPEC-15: command-family evidence cannot invent scenarios or full baseline completion",
  () =>
    Effect.gen(function* () {
      const spec = yield* loadSpecification;
      const descriptor = spec.descriptors[0];
      if (descriptor === undefined) return yield* Effect.die("Missing descriptor");
      const evidence = spec.scenarios.find((scenario) => scenario.id === "HANDSHAKE")?.evidence;
      if (evidence === undefined) return yield* Effect.die("Missing prerequisite evidence");
      const scenarios = spec.scenarios.map((scenario) =>
        scenario.id === "COMMAND"
          ? {
              ...scenario,
              execution: "passed" as const,
              evidence: { ...evidence, scenarioIds: ["COMMAND-INVENTED"] as const },
            }
          : scenario,
      );
      expect(validateSpecification({ ...spec, scenarios })).toContain(
        "Missing command-system evidence scenario: COMMAND-INVENTED",
      );
      const commands = spec.commands.map((command) =>
        command.name === descriptor.name
          ? { ...command, implementation: "implemented" as const }
          : command,
      );
      expect(validateSpecification({ ...spec, commands })).toContain(
        `Partial command lacks a reviewed descriptor: ${descriptor.name}`,
      );
    }),
);
