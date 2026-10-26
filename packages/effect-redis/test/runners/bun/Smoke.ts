import { Effect, Redacted } from "effect";

import type { RedisCommand } from "#/index";
import { core, native, ensure, equalBytes } from "#test/runners/bun/Runtime";

/** Endpoint mode admits only connection AUTH and read-only PING/ECHO. */
export const smoke = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const connection = yield* native.connect(config);
  const decoder = yield* Effect.fromResult(core.makeRespDecoder(config.limits));
  const exchange = Effect.fnUntraced(function* (tokens: RedisCommand) {
    yield* connection.write(yield* Effect.fromResult(core.encodeCommand(tokens, config.limits)));
    while (true) {
      const reply = yield* Effect.fromResult(decoder.next());
      if (reply !== undefined) return reply;

      const bytes = yield* connection.read;
      ensure(bytes !== undefined, "Smoke peer closed without reply");
      yield* Effect.fromResult(decoder.feed(bytes));
    }
  });

  if (config.credentials !== undefined) {
    const { username, password } = config.credentials;
    const authenticated = yield* exchange([
      "AUTH",
      ...(username === undefined ? [] : [Redacted.value(username)]),
      Redacted.value(password),
    ]);
    ensure(
      authenticated._tag === "SimpleString" &&
        new TextDecoder().decode(authenticated.value) === "OK",
      "Endpoint authentication rejected",
    );
  }

  const pong = yield* exchange(["PING"]);
  ensure(
    pong._tag === "SimpleString" && new TextDecoder().decode(pong.value) === "PONG",
    "Unexpected PING receipt",
  );
  const payload = new Uint8Array([0, 255, 128, 13, 10]);
  const echoed = yield* exchange(["ECHO", payload]);
  ensure(
    echoed._tag === "BlobString" && equalBytes(echoed.value, payload),
    "Binary ECHO receipt changed",
  );
  yield* connection.close;

  return ["connection-only-auth", "read-only-ping", "binary-echo"];
});
