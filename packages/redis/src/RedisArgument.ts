/** A command token. Numeric options are encoded explicitly; binary tokens stay bytes. */
export type RedisArgument = string | Uint8Array;
