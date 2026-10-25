import { readFileSync } from "node:fs";

import { Schema } from "effect";

import { expect, it } from "vitest";

import { CommandMetadata } from "#/command/Metadata";
import { pingMetadata } from "#/commands/connection/Ping";
import { zscoreMetadata } from "#/commands/sorted-sets/Zscore";
import { getMetadata } from "#/commands/strings/Get";
import { incrMetadata } from "#/commands/strings/Incr";
import { setMetadata } from "#/commands/strings/Set";

const reviewed = ["connection", "strings", "sorted-sets"].flatMap((family) =>
  Schema.decodeUnknownSync(Schema.NonEmptyArray(CommandMetadata))(
    JSON.parse(
      readFileSync(new URL(`../../fixtures/commands/${family}.json`, import.meta.url), "utf8"),
    ),
  ),
);

const byName = (a: CommandMetadata, b: CommandMetadata) => a.name.localeCompare(b.name);

it("reviewed command metadata matches the public descriptors", () => {
  const production = [pingMetadata, getMetadata, incrMetadata, setMetadata, zscoreMetadata];

  expect(production.toSorted(byName)).toEqual(reviewed.toSorted(byName));
});
