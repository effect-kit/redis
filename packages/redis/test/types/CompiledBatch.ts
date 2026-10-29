import type { Effect, Option } from "effect";

import { Commands, RedisKey } from "#/index";
import type { RedisClient } from "#/index";
import { labelSchema } from "#test/support/commands/SchemaServices";
import type { DecodeLabel, EncodeLabel } from "#test/support/commands/SchemaServices";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

declare const redis: RedisClient;
const values = redis.batch([Commands.get("a"), Commands.incr("b")]);
const empty = redis.batch([]);
const labels = RedisKey.schemaText("label", labelSchema);
const compilation = redis.compile([Commands.setKey(labels, "v"), Commands.getKey(labels)]);
declare const plan: Effect.Success<typeof compilation>;
const execution = plan.execute();

export type CompiledBatchInference = [
  Assert<Equal<Effect.Success<typeof values>, readonly [Option.Option<string>, bigint]>>,
  Assert<Equal<Effect.Services<typeof values>, never>>,
  Assert<Equal<Effect.Success<typeof empty>, readonly []>>,
  Assert<Equal<Effect.Services<typeof compilation>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof execution>, DecodeLabel>>,
  Assert<Equal<Effect.Success<typeof execution>, readonly [void, Option.Option<string>]>>,
];
