import { Effect } from "effect";

import type * as Native from "#/bun";
import type * as Core from "#/index";

const core = (await import(new URL("../../../dist/index.js", import.meta.url).href)) as typeof Core;
const native = (await import(
  new URL("../../../dist/bun.js", import.meta.url).href
)) as typeof Native;

const program = Effect.gen(function* () {
  const connection = yield* core.makeConnection(
    yield* core.decodeRedisConfig({ endpoint: { path: process.argv[2] } }),
  );
  const redis = core.makeRedis(core.makeExecutor(connection));
  yield* redis.ping();
  const bytes = new Uint8Array([0, 255, 128, 13, 10]);
  const echoed = yield* redis.echo(bytes);
  if (echoed.length !== bytes.length || !echoed.every((byte, index) => byte === bytes[index]))
    return yield* Effect.fail(new Error("Bun Unix binary exchange failed"));

  return {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    transport: "unix",
    exchanges: 2,
    engine: true,
  };
}).pipe(Effect.provide(native.layer));

await Effect.runPromise(Effect.scoped(program)).then(
  (receipt) => console.log(JSON.stringify(receipt)),
  (error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  },
);
