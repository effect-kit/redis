import { Effect } from "effect";

import { pairs, simpleText } from "#/command/reply/Data";
import type { RespValue } from "#/protocol/RespValue";
import { FixtureError } from "#test/support/servers/FixtureError";

export const moduleIdentity = Effect.fnUntraced(function* (
  reply: RespValue,
  expected: Readonly<Record<string, string>>,
) {
  if (reply._tag !== "Array") return yield* new FixtureError({ stage: "module-list" });
  const observed: Record<string, string> = {};
  for (const entry of reply.values) {
    const fields = yield* pairs(simpleText, Effect.succeed)(entry);
    const name = fields.find(([key]) => key === "name")?.[1];
    const version = fields.find(([key]) => key === "ver")?.[1];
    if (name === undefined || version?._tag !== "Integer")
      return yield* new FixtureError({ stage: "module-identity" });
    observed[yield* simpleText(name)] = String(version.value);
  }

  if (
    JSON.stringify(Object.entries(observed).toSorted()) !==
    JSON.stringify(Object.entries(expected).toSorted())
  )
    return yield* new FixtureError({ stage: "module-version" });
  return observed;
});
