import { Effect } from "effect";

import type * as Core from "../src/index.js";
import type * as Native from "../src/node.js";

const core = (await import(new URL("../dist/index.js", import.meta.url).href)) as typeof Core;
const native = (await import(new URL("../dist/node.js", import.meta.url).href)) as typeof Native;

const smoke = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* core.decodeRedisConfig({ endpoint: { path: process.argv[2] } });
    const connection = yield* core.makeConnection(config);
    const payload = new Uint8Array([0, 255, 128, 13, 10]);
    const commands: ReadonlyArray<Core.RedisCommand> = [["PING"], ["ECHO", payload]];
    for (const command of commands) {
      const reply = yield* connection.executeOrdinary(command);
      const expected = command[0] === "PING" ? new TextEncoder().encode("PONG") : payload;
      if (
        (reply._tag !== "SimpleString" && reply._tag !== "BlobString") ||
        reply.value.length !== expected.length ||
        !reply.value.every((byte, index) => byte === expected[index])
      )
        return yield* Effect.fail(new Error("Unexpected connection Unix smoke reply"));
    }
    yield* connection.close;
    return {
      node: process.versions.node,
      transport: "unix",
      exchanges: commands.length,
      engine: true,
    };
  }),
).pipe(Effect.provide(native.layer));

Effect.runPromise(smoke).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
