import type { RedisArgument } from "#/RedisArgument";

export const argumentBytes = (value: RedisArgument) =>
  typeof value === "string" ? new TextEncoder().encode(value) : value;

export const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);
