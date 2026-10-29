import { readFile } from "node:fs/promises";

import { measure } from "#test/runners/benchmarks/Measurement";
import { Input } from "#test/runners/benchmarks/Options";
import { readInput } from "#test/runners/providers/Stdin";

const input = await readInput(Input);
// Import only the selected driver: native GLIDE and its threads must not affect other clients.
const operation = await (async () => {
  switch (input.client) {
    case "effect-redis":
      return (await import("#test/runners/benchmarks/clients/EffectRedis")).effectRedis(input);
    case "ioredis":
      return (await import("#test/runners/benchmarks/clients/Ioredis")).ioredis(input);
    case "node-redis":
      return (await import("#test/runners/benchmarks/clients/NodeRedis")).nodeRedis(input);
    case "valkey-glide":
      return (await import("#test/runners/benchmarks/clients/Glide")).glide(input);
  }
})();

try {
  operation.verify(await operation.promise());
  await measure(input, operation, input.warmupMillis);
  globalThis.gc?.();
  const measurement = await measure(input, operation, input.sampleMillis);
  operation.verify(await operation.promise());
  const name = {
    "effect-redis": "@effect-kit/redis",
    ioredis: "ioredis",
    "node-redis": "redis",
    "valkey-glide": "@valkey/valkey-glide",
  }[input.client];
  const manifest = JSON.parse(
    await readFile(
      input.client === "effect-redis"
        ? new URL("../../../package.json", import.meta.url)
        : new URL(`../../../node_modules/${name}/package.json`, import.meta.url),
      "utf8",
    ),
  );

  process.stdout.write(
    JSON.stringify({
      client: input.client,
      version: manifest.version,
      execution: input.execution,
      workload: input.workload,
      node: process.versions.node,
      settings: operation.settings,
      measurement,
    }),
  );
} finally {
  await operation.close();
}
