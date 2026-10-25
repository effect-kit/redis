import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { pingMetadata } from "../../src/commands/connection/Ping.js";
import { zscoreMetadata } from "../../src/commands/sorted-sets/Zscore.js";
import { getMetadata } from "../../src/commands/strings/Get.js";
import { incrMetadata } from "../../src/commands/strings/Incr.js";
import { setMetadata } from "../../src/commands/strings/Set.js";
import { loadSpecification } from "../../tools/spec/Load.ts";
import { Descriptor } from "../../tools/spec/Schema.ts";
import { validateSpecification } from "../../tools/spec/Validate.ts";

const byName = (a: typeof Descriptor.Type, b: typeof Descriptor.Type) =>
  a.name.localeCompare(b.name);

it.live("SPEC-09: reviewed family catalogs match production descriptor contracts", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const production = [pingMetadata, getMetadata, incrMetadata, setMetadata, zscoreMetadata];

    expect(spec.descriptors.toSorted(byName)).toEqual(production.toSorted(byName));
    expect(validateSpecification(spec)).toEqual([]);
  }),
);

it.live("SPEC-10: descriptor scenarios and catalog counts cannot drift", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const descriptor = spec.descriptors[0];
    if (descriptor === undefined) return yield* Effect.die("Missing descriptor");

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
  }),
);

it.live("SPEC-11: duplicate descriptor identities fail instead of hiding another command", () =>
  Effect.gen(function* () {
    const spec = yield* loadSpecification;
    const descriptor = spec.descriptors[0];
    if (descriptor === undefined) return yield* Effect.die("Missing descriptor");

    expect(
      validateSpecification({ ...spec, descriptors: [descriptor, ...spec.descriptors] }),
    ).toContain("Duplicate descriptor names");
  }),
);
