import { Effect, Schema } from "effect";

import { client } from "#test/runners/conformance/Client";
import { strings } from "#test/runners/conformance/data/Strings";
import { core, readyLayer } from "#test/runners/conformance/Runtime";
import { nativeInput } from "#test/support/client/Input";
import { Input } from "#test/support/conformance/Contract";

let text = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  text += String(chunk);
  if (text.length > 65536) throw new Error("Conformance input limit");
}
const input = Schema.decodeUnknownSync(Input)(JSON.parse(text));

const program = Effect.gen(function* () {
  if (readyLayer === undefined) return yield* Effect.die("Missing runtime Layer");
  const config = yield* core.decodeRedisConfig(input.config);

  const observations = yield* Effect.gen(function* () {
    const fixture = yield* client(input);
    if (input.domain === "strings") yield* strings(fixture);
    else return yield* Effect.die("Conformance domain not implemented");
    return fixture.observations;
  }).pipe(Effect.provide(readyLayer(nativeInput(config))));

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
    observations,
  };
});

try {
  const receipt = await Effect.runPromise(Effect.scoped(program));
  process.stdout.write(JSON.stringify(receipt));
} catch (error) {
  process.stderr.write(
    `Conformance failed: ${error instanceof Error ? error.message : "unknown"}\n`,
  );
  process.exitCode = 1;
}
