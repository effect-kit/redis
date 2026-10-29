import { Effect } from "effect";

import type { Input } from "#test/runners/benchmarks/Options";

export const small = Buffer.alloc(256, 97);
export const large = Buffer.alloc(65536, 98);

export interface Operation {
  readonly effect: Effect.Effect<unknown, unknown>;
  readonly promise: () => Promise<unknown>;
  readonly verify: (reply: unknown) => void;
  readonly close: () => Promise<void>;
  readonly settings: Readonly<Record<string, string | boolean | number>>;
}

export const verifyReply = (input: Input) => (reply: unknown) => {
  if (input.workload.startsWith("get-")) {
    const expected = input.workload === "get-64k-c8" ? large : small;
    if (
      !(reply instanceof Uint8Array) ||
      !Buffer.from(reply.buffer, reply.byteOffset, reply.byteLength).equals(expected)
    )
      throw new Error("GET returned incorrect bytes");
    return;
  }

  if (input.workload === "incr-c16") {
    if (
      !(typeof reply === "bigint"
        ? reply > 0n
        : typeof reply === "number" && Number.isSafeInteger(reply) && reply > 0)
    )
      throw new Error("INCR returned an invalid integer");
    return;
  }

  if (input.workload === "set-256b-c16") {
    if (reply !== undefined && reply !== "OK") throw new Error("SET did not succeed");
    return;
  }

  const count = input.workload === "transaction-8-c1" ? 8 : 32;
  if (
    !Array.isArray(reply) ||
    reply.length !== count ||
    !reply.every(
      (value: unknown) =>
        value instanceof Uint8Array &&
        Buffer.from(value.buffer, value.byteOffset, value.byteLength).equals(small),
    )
  )
    throw new Error("Batch returned incorrect replies");
};

export const promiseOperation = (
  input: Input,
  promise: () => Promise<unknown>,
  close: () => Promise<void>,
  settings: Operation["settings"],
): Operation => ({
  promise,
  effect: Effect.tryPromise({ try: promise, catch: (cause) => cause }),
  verify: verifyReply(input),
  close,
  settings,
});
