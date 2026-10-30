import { Effect, Layer, Schema } from "effect";

import { authError, client, smallBuffer } from "#test/runners/bun/Client";
import { cluster } from "#test/runners/bun/Cluster";
import { events } from "#test/runners/bun/Events";
import { modules } from "#test/runners/bun/Modules";
import { pipelinedTransactions } from "#test/runners/bun/PipelinedTransactions";
import { core, native } from "#test/runners/bun/Runtime";
import { sentinel } from "#test/runners/bun/Sentinel";
import { sessions } from "#test/runners/bun/Sessions";
import { smoke } from "#test/runners/bun/Smoke";
import { transport } from "#test/runners/bun/Transport";
import { uncertainty } from "#test/runners/bun/Uncertainty";
import { RuntimeInput } from "#test/support/runtime/bun/Input";

const program = Effect.gen(function* () {
  const text = yield* Effect.promise(() =>
    process.argv[2] === undefined ? Bun.stdin.text() : Bun.file(process.argv[2]).text(),
  );
  const input = yield* Effect.try({
    try: () => {
      if (text.length > 65536) throw new Error("Input limit");
      return Schema.decodeUnknownSync(RuntimeInput)(JSON.parse(text));
    },
    catch: () => new Error("Invalid Bun scenario input"),
  });
  const checks = yield* (() => {
    switch (input.scenario) {
      case "pipelined-transactions":
        return pipelinedTransactions(input.config, input.engine);
      case "small-buffer":
        return smallBuffer(input.config);
      case "application":
        return Effect.gen(function* () {
          return [
            ...(yield* client(input.config)),
            ...(yield* sessions(input.config)),
            ...(yield* events(input.config)),
          ];
        });
      case "smoke":
        return smoke(input.config);
      case "uncertainty":
        return uncertainty(input);
      case "cluster":
        return cluster(input);
      case "sentinel":
        return sentinel(input);
      case "modules":
        return modules(input);
      case "transport":
        return transport(input);
      case "client":
        return client(input.config);
      case "sessions":
        return sessions(input.config);
      case "events":
        return events(input.config);
      case "auth-error":
        return authError(input.config);
    }
  })();

  return {
    bun: Bun.version,
    revision: Bun.revision,
    platform: process.platform,
    architecture: process.arch,
    scenario: input.scenario,
    checks,
  };
}).pipe(Effect.provide(Layer.merge(native.layer, native.cryptoLayer)));

await Effect.runPromise(Effect.scoped(program)).then(
  (receipt) => console.log(JSON.stringify(receipt)),
  (error: unknown) => {
    console.error(
      error instanceof core.HandshakeError ||
        error instanceof core.RedisConfigError ||
        error instanceof core.TransportError
        ? JSON.stringify(error)
        : String(error),
    );
    process.exitCode = 1;
  },
);
