import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted } from "effect";

import { makeRespDecoder } from "#/index";
import { FixtureError } from "#test/support/servers/FixtureError";

/** Read the module's own opaque AOF serialization; no client-side Bloom implementation is substituted. */
export const bloomAofPayload = Effect.fnUntraced(function* (directory: string) {
  const bytes = yield* Effect.tryPromise({
    try: async () => {
      const folder = join(directory, "appendonlydir");
      const names = (await readdir(folder))
        .filter((name) => name.endsWith(".base.aof"))
        .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const name = names.at(-1);
      if (name === undefined) throw new Error("No rewritten AOF");
      const file = join(folder, name);
      if ((await stat(file)).size > 65536) throw new Error("Unexpected fixture AOF size");
      return readFile(file);
    },
    catch: (cause) => new FixtureError({ stage: "module-aof-read", cause: Redacted.make(cause) }),
  });
  const decoder = yield* Effect.fromResult(makeRespDecoder());
  yield* Effect.fromResult(decoder.feed(bytes));
  decoder.end();

  while (true) {
    const command = yield* Effect.fromResult(decoder.next());
    if (command === undefined) return yield* new FixtureError({ stage: "module-aof-missing-load" });
    if (command._tag !== "Array") return yield* new FixtureError({ stage: "module-aof-shape" });
    const [name, , payload] = command.values;
    if (name?._tag === "BlobString" && new TextDecoder().decode(name.value) === "BF.LOAD") {
      if (payload?._tag !== "BlobString")
        return yield* new FixtureError({ stage: "module-aof-payload" });
      return payload.value;
    }
  }
});
