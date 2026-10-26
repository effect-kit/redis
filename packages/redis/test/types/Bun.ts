import { Effect, Layer } from "effect";
import type { Scope, Crypto } from "effect";

import { connect, cryptoLayer, layer } from "#/bun";
import { CommandExecutor, Connection, Redis, RedisScript, Reply } from "#/index";
import type { RedisConfig, TransportConnection } from "#/index";

declare const config: RedisConfig;
const acquired = connect(config);
const script = RedisScript.make({ source: "return 1", decode: Reply.integer });
const hashed = script.pipe(Effect.provide(cryptoLayer));
const native = Redis.layer.pipe(
  Layer.provide(CommandExecutor.layer),
  Layer.provide(Connection.layer(config)),
  Layer.provide(layer),
);
const runnable = Effect.scoped(
  Effect.gen(function* () {
    const redis = yield* Redis;
    return yield* redis.incr("counter");
  }).pipe(Effect.provide(native)),
);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type BunContracts = [
  Assert<Equal<Effect.Success<typeof acquired>, TransportConnection>>,
  Assert<Equal<Effect.Services<typeof acquired>, Scope.Scope>>,
  Assert<Equal<Effect.Services<typeof script>, Crypto.Crypto>>,
  Assert<Equal<Effect.Services<typeof hashed>, never>>,
  Assert<Equal<Effect.Success<typeof runnable>, bigint>>,
  Assert<Equal<Effect.Services<typeof runnable>, never>>,
];

// @ts-expect-error Native transport requires a decoded full configuration.
connect({ endpoint: { host: "localhost" } });
