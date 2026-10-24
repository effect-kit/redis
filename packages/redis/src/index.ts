/**
 * A binary-safe Redis command token. Command builders encode numeric arguments
 * as strings; arbitrary binary keys and values remain bytes.
 */
export type RedisArgument = string | Uint8Array;
