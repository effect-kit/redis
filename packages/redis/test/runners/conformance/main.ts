import { createReadStream } from "node:fs";

import { Cause, Effect, Schema } from "effect";

import { administration } from "#test/runners/conformance/Administration";
import { client } from "#test/runners/conformance/Client";
import { collections } from "#test/runners/conformance/data/Collections";
import { keys } from "#test/runners/conformance/data/Keys";
import { ordered } from "#test/runners/conformance/data/Ordered";
import { sparse } from "#test/runners/conformance/data/Sparse";
import { strings } from "#test/runners/conformance/data/Strings";
import { events } from "#test/runners/conformance/events/index";
import { extensions } from "#test/runners/conformance/Extensions";
import { inventory } from "#test/runners/conformance/Inventory";
import { modules } from "#test/runners/conformance/modules/index";
import { core, readyLayer } from "#test/runners/conformance/Runtime";
import { garnetLua } from "#test/runners/conformance/sessions/Garnet";
import { sessions } from "#test/runners/conformance/sessions/index";
import { uncertainty } from "#test/runners/conformance/Uncertainty";
import { nativeInput } from "#test/support/client/Input";
import { Input } from "#test/support/conformance/Contract";
import { regularDomains } from "#test/support/conformance/Domains";

const suites = {
  strings,
  collections,
  keys,
  ordered,
  sessions,
  events,
  modules,
  extensions,
  sparse,
  administration,
  uncertainty,
  "garnet-lua": garnetLua,
};
let text = "";
const source = process.argv[2] === undefined ? process.stdin : createReadStream(process.argv[2]);
source.setEncoding("utf8");
for await (const chunk of source) {
  text += String(chunk);
  if (text.length > 65536) throw new Error("Conformance input limit");
}
const input = Schema.decodeUnknownSync(Input)(JSON.parse(text));

const program = Effect.gen(function* () {
  if (readyLayer === undefined) return yield* Effect.die("Missing runtime Layer");
  const config = yield* core.decodeRedisConfig(input.config);
  const profile = core.RedisProfiles[input.engine]();

  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* client(input);
      const observedInventory = yield* inventory(fixture);
      yield* Effect.gen(function* () {
        const selected = input.domain === "all" ? regularDomains : [input.domain];
        for (const domain of selected) yield* suites[domain](fixture);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (exit._tag === "Failure")
              process.stderr.write(
                `Last completed scenario: ${fixture.observations.at(-1)?.id ?? "none"}\n`,
              );
          }),
        ),
      );
      return { observations: fixture.observations, inventory: observedInventory };
    }),
  ).pipe(Effect.provide(readyLayer({ ...nativeInput(config), profile })));

  return {
    runtime: typeof Bun === "undefined" ? "node" : "bun",
    runtimeVersion: typeof Bun === "undefined" ? process.versions.node : Bun.version,
    ...(typeof Bun === "undefined" ? {} : { runtimeRevision: Bun.revision }),
    platform: process.platform,
    architecture: process.arch,
    engine: input.engine,
    version: input.version,
    protocol: input.protocol,
    domain: input.domain,
    profile: { id: profile.id, revision: profile.revision },
    ...result,
  };
});

const exit = await Effect.runPromiseExit(Effect.scoped(program));
if (exit._tag === "Success") process.stdout.write(JSON.stringify(exit.value));
else {
  const error = Cause.squash(exit.cause);
  const diagnostic: Record<string, unknown> = {};
  if (typeof error === "object" && error !== null) {
    for (const key of ["_tag", "stage", "kind", "reason", "expected", "actual", "path", "delivery"])
      diagnostic[key] = Reflect.get(error, key);
  }
  process.stderr.write(
    `Conformance failed: ${JSON.stringify(diagnostic, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value))} ${error instanceof Error ? error.message : "unknown"}\n`,
  );
  process.exitCode = 1;
}
