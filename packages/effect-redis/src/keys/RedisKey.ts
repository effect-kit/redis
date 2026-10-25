import type { Schema } from "effect";

import * as PayloadCodec from "../codecs/PayloadCodec.js";
import type { RedisArgument } from "../RedisArgument.js";

export interface RedisKey<A, RD = never, RE = never> {
  readonly name: RedisArgument;
  readonly codec: PayloadCodec.PayloadCodec<A, RD, RE>;
}
export const make = <A, RD, RE>(
  name: RedisArgument,
  codec: PayloadCodec.PayloadCodec<A, RD, RE>,
): RedisKey<A, RD, RE> => ({ name, codec });
export const text = (name: RedisArgument): RedisKey<string> => make(name, PayloadCodec.text);
export const json = <S extends Schema.Constraint>(
  name: RedisArgument,
  schema: S,
): RedisKey<S["Type"], S["DecodingServices"], S["EncodingServices"]> =>
  make(name, PayloadCodec.json(schema));
export const schemaText = <A, RD, RE>(
  name: RedisArgument,
  schema: Schema.Codec<A, string, RD, RE>,
): RedisKey<A, RD, RE> => make(name, PayloadCodec.schemaText(schema));
