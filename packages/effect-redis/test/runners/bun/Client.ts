import { Crypto, Effect, Option, Result, Schema, Stream } from "effect";

import { core, ensure, equalBytes } from "#test/runners/bun/Runtime";

export const client = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const connection = yield* core.makeConnection(config);
  const redis = core.makeRedis(core.makeExecutor(connection));
  const prefix = `bun:${crypto.randomUUID()}`;
  const bytes = new Uint8Array([0, 255, 128, 13, 10]);
  const cryptography = yield* Crypto.Crypto;
  ensure(
    (yield* cryptography.randomBytes(65537)).length === 65537,
    "Native entropy crossed the Web Crypto quota incorrectly",
  );
  const digest = yield* cryptography.digest("SHA-256", new TextEncoder().encode("abc"));
  ensure(
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") ===
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "Native digest changed",
  );

  yield* redis.ping();
  yield* redis.set(`${prefix}:bytes`, bytes);
  const saved = yield* redis.getBytes(`${prefix}:bytes`);
  ensure(Option.isSome(saved) && equalBytes(saved.value, bytes), "Binary value changed");
  const large = new Uint8Array(2 * 1024 * 1024).fill(17);
  yield* redis.set(`${prefix}:large`, large);
  const largeReply = yield* redis.getBytes(`${prefix}:large`);
  ensure(
    Option.isSome(largeReply) && equalBytes(largeReply.value, large),
    "Large reply lost byte ownership",
  );
  ensure(
    (yield* Effect.flip(redis.get(`${prefix}:bytes`)))._tag === "ReplyError",
    "Invalid UTF-8 was coerced",
  );
  ensure(Option.isNone(yield* redis.get(`${prefix}:missing`)), "Missing value was invented");
  yield* redis.set(`${prefix}:integer`, "9007199254740992");
  ensure(
    (yield* redis.incr(`${prefix}:integer`)) === 9007199254740993n,
    "Integer precision changed",
  );

  yield* redis.hset(`${prefix}:hash`, [["field", bytes]]);
  const field = yield* redis.hget(`${prefix}:hash`, "field");
  ensure(Option.isSome(field) && equalBytes(field.value, bytes), "Hash bytes changed");
  yield* redis.rpush(`${prefix}:list`, [bytes]);
  const popped = yield* redis.lpop(`${prefix}:list`);
  ensure(Option.isSome(popped) && equalBytes(popped.value, bytes), "List bytes changed");
  yield* redis.sadd(`${prefix}:set`, [bytes]);
  ensure(yield* redis.sismember(`${prefix}:set`, bytes), "Set membership changed");
  yield* redis.zadd(`${prefix}:sorted`, [[1.5, bytes]]);
  const score = yield* redis.zscore(`${prefix}:sorted`, bytes);
  ensure(Option.isSome(score) && score.value === 1.5, "Sorted score changed");
  yield* redis.setbit(`${prefix}:bits`, 7, 1);
  ensure((yield* redis.bitcount(`${prefix}:bits`)) === 1n, "Bitmap count changed");
  yield* redis.pfadd(`${prefix}:hll`, ["member"]);
  ensure((yield* redis.pfcount([`${prefix}:hll`])) === 1n, "HyperLogLog count changed");
  yield* redis.geoadd(`${prefix}:geo`, [{ longitude: 13, latitude: 38, member: "point" }]);
  ensure(
    Option.isSome((yield* redis.geopos(`${prefix}:geo`, ["point"]))[0] ?? Option.none()),
    "Geo position missing",
  );
  ensure(yield* redis.pexpire(`${prefix}:bytes`, 10000), "Expiry was not applied");

  const key = core.RedisKey.json(`${prefix}:schema`, Schema.Struct({ name: Schema.String }));
  yield* redis.setKey(key, { name: "Bun" });
  const decoded = yield* redis.getKey(key);
  ensure(Option.isSome(decoded) && decoded.value.name === "Bun", "Schema payload changed");
  const scanned = yield* Stream.runCollect(redis.scanKeys({ match: `${prefix}:*`, count: 1 }));
  ensure(scanned.length >= 8, "Cursor traversal lost owned keys");

  const scripts = yield* core.makeRedisScripts(yield* core.makeRedisSessions(config));
  const script = yield* core.RedisScript.make({
    source: "return redis.call('INCR', KEYS[1])",
    decode: core.Reply.integer,
  });
  ensure(
    (yield* scripts.execute(script, { keys: [`${prefix}:script`] })) === 1n,
    "Native SHA script failed",
  );
  yield* redis.scriptFlush();
  ensure(
    (yield* scripts.execute(script, { keys: [`${prefix}:script`] })) === 2n,
    "NOSCRIPT recovery failed",
  );

  return [
    "binary",
    "int64",
    "typed-errors",
    "core-families",
    "schema",
    "scan",
    "native-crypto",
    "scripts",
  ];
});

export const authError = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const failure = yield* Effect.flip(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* core.makeConnection(config);
        yield* core.makeRedis(core.makeExecutor(connection)).ping();
      }),
    ),
  );
  ensure(failure._tag === "HandshakeError", "Authentication failure did not retain handshake type");
  return ["authentication-failure", "no-protocol-fallback"];
});

export const smallBuffer = Effect.fnUntraced(function* (input: unknown) {
  const config = yield* core.decodeRedisConfig(input);
  const sessions = yield* core.makeRedisSessions(config);
  const payload = new Uint8Array(16).fill(17);
  const results = yield* sessions.pipeline(
    Array.from({ length: 64 }, () => core.Commands.echo(payload)),
  );

  ensure(
    results.length === 64 &&
      results.every((result) => Result.isSuccess(result) && equalBytes(result.success, payload)),
    "Coalesced replies exceeded the protocol retention budget",
  );
  return ["small-protocol-budget", "coalesced-native-replies", "ordered-pipeline"];
});
