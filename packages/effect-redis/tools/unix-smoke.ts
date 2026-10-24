import { Effect } from "effect";

import type * as Core from "../src/index.js";
import type * as Native from "../src/node.js";

const core = (await import(new URL("../dist/index.js", import.meta.url).href)) as typeof Core;
const native = (await import(new URL("../dist/node.js", import.meta.url).href)) as typeof Native;

const smoke = Effect.scoped(
  Effect.gen(function* () {
    const connection = yield* native.connect(
      yield* core.decodeRedisConfig({ endpoint: { path: process.argv[2] } }),
    );
    const payload = new Uint8Array([0, 255, 128, 13, 10]);
    const commands: ReadonlyArray<Core.RedisCommand> = [["PING"], ["ECHO", payload]];
    for (const command of commands) {
      const decoder = yield* Effect.fromResult(core.makeRespDecoder());
      yield* connection.write(yield* Effect.fromResult(core.encodeCommand(command)));
      while (true) {
        const reply = yield* Effect.fromResult(decoder.next());
        if (reply !== undefined) {
          const expected = command[0] === "PING" ? new TextEncoder().encode("PONG") : payload;
          if (
            (reply._tag !== "SimpleString" && reply._tag !== "BlobString") ||
            reply.value.length !== expected.length ||
            !reply.value.every((byte, index) => byte === expected[index])
          )
            return yield* Effect.fail(new Error("Unexpected Unix smoke reply"));
          break;
        }
        const bytes = yield* connection.read;
        if (bytes === undefined)
          return yield* Effect.fail(new Error("Unix peer closed without reply"));
        yield* Effect.fromResult(decoder.feed(bytes));
      }
    }
    return { node: process.versions.node, transport: "unix", exchanges: commands.length };
  }),
);

Effect.runPromise(smoke).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
