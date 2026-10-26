import { Effect, Fiber, Option, Redacted, Result, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import type * as Core from "#/index";
import type * as Http from "#/upstash";

const core = (await import(new URL("../../../dist/index.js", import.meta.url).href)) as typeof Core;
const http = (await import(
  new URL("../../../dist/upstash.js", import.meta.url).href
)) as typeof Http;

const Input = Schema.Struct({
  url: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  prefix: Schema.NonEmptyString,
});
let text = "";
process.stdin.setEncoding("utf8");
for await (const bytes of process.stdin) {
  text += String(bytes);
  if (text.length > 65536) throw new Error("HTTP runtime input limit");
}
const input = (() => {
  try {
    return Schema.decodeUnknownSync(Input)(JSON.parse(text));
  } catch {
    throw new Error("Invalid HTTP runtime input");
  }
})();

function ensure(condition: unknown, check: string): asserts condition {
  if (!condition) throw new Error(`HTTP runtime check failed: ${check}`);
}

const program = Effect.gen(function* () {
  const client = yield* http.makeUpstash({
    url: input.url,
    token: Redacted.make(input.token),
    allowInsecureLocalhost: true,
    pipelineResponseFormat: "frames",
  });
  const redis = client.redis;
  const prefix = input.prefix;
  const checks: Array<string> = [];

  yield* redis.set(`${prefix}:binary`, new Uint8Array([0, 255, 128]));
  const binary = Option.getOrThrow(yield* redis.getBytes(`${prefix}:binary`));
  ensure(
    binary.length === 3 && binary[0] === 0 && binary[1] === 255 && binary[2] === 128,
    "binary",
  );
  checks.push("binary");
  ensure(
    (yield* redis.incrby(`${prefix}:integer`, 9007199254740993n)) === 9007199254740993n,
    "int64",
  );
  checks.push("int64");

  const profile = core.RedisKey.json(
    `${prefix}:profile`,
    Schema.Struct({ name: Schema.String, visits: Schema.Int }),
  );
  yield* redis.setKey(profile, { name: "雪", visits: 2 });
  ensure(Option.getOrThrow(yield* redis.getKey(profile)).name === "雪", "Schema");
  checks.push("Schema");

  const pipeline = yield* client.batches.pipeline([
    core.Commands.set(`${prefix}:batch`, "OK"),
    core.Commands.incr(`${prefix}:batch`),
  ]);
  ensure(Result.isSuccess(pipeline[0]) && Result.isFailure(pipeline[1]), "pipeline");
  const transaction = yield* client.batches.transaction([
    core.Commands.getBytes(`${prefix}:batch`),
    core.Commands.incr(`${prefix}:integer`),
  ]);
  ensure(
    transaction._tag === "Committed" &&
      Result.getOrThrow(transaction.results[1]) === 9007199254740994n,
    "transaction",
  );
  checks.push("batches");

  const id = yield* redis.xadd(`${prefix}:stream`, "*", [["field", "value"]]);
  ensure((yield* redis.xrange(`${prefix}:stream`, "-", "+"))[0]?.id === id, "Streams");
  checks.push("Streams");

  const subscription = yield* client.events.subscribe(`${prefix}:channel`);
  const receiving = yield* subscription.messages.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* redis.publish(`${prefix}:channel`, "hello,雪");
  ensure((yield* Fiber.join(receiving))[0]?.message === "hello,雪", "SSE");
  yield* subscription.close;
  checks.push("SSE");

  const unsupported = yield* Effect.flip(redis.upstash.vectorCount(`${prefix}:vector`));
  ensure(unsupported._tag === "ServerError", "provider-errors");
  checks.push("provider-errors");

  yield* Effect.gen(function* () {
    const ready = yield* core.Redis;
    const credentials = yield* core.RedisCredentials;
    ensure(Option.getOrThrow(yield* ready.get(`${prefix}:batch`)) === "OK", "ready-http");
    const batch = yield* ready.pipeline([core.Commands.get(`${prefix}:batch`)]);
    ensure(Option.getOrThrow(Result.getOrThrow(batch[0])) === "OK", "ready-http-batch");
    yield* credentials.rotate;
    yield* ready.ping();
  }).pipe(
    Effect.provide(
      http.RedisUpstash.layer({
        url: input.url,
        allowInsecureLocalhost: true,
        pipelineResponseFormat: "frames",
        credentials: Effect.succeed({ password: Redacted.make(input.token) }),
      }),
    ),
  );
  checks.push("ready-layer", "ready-batches", "explicit-rotation");

  return {
    runtime: typeof Bun === "undefined" ? "node" : "bun",
    version: typeof Bun === "undefined" ? process.versions.node : Bun.version,
    ...(typeof Bun === "undefined" ? {} : { revision: Bun.revision }),
    platform: process.platform,
    architecture: process.arch,
    checks,
  };
});

try {
  const receipt = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(FetchHttpClient.layer))),
  );
  process.stdout.write(JSON.stringify(receipt));
} catch (error) {
  process.stderr.write(`HTTP runtime failed: ${error instanceof Error ? error.name : "Unknown"}\n`);
  process.exitCode = 1;
}
