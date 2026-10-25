import { Result } from "effect";

import { expect } from "vitest";

import { ProtocolError } from "#/errors/ProtocolError";
import { makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RespDecodeLimits } from "#/protocol/limits";
import type { RespValue } from "#/protocol/RespValue";

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
export const joinBytes = (...chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const joined = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
};

export const decodeChunks = (
  chunks: ReadonlyArray<Uint8Array>,
  options?: Partial<RespDecodeLimits>,
): Array<RespValue> => {
  const decoder = Result.getOrThrow(makeRespDecoder(options));
  const values: Array<RespValue> = [];
  const drain = () => {
    while (true) {
      const value = Result.getOrThrow(decoder.next());
      if (value === undefined) return;
      values.push(value);
    }
  };
  for (const chunk of chunks) {
    Result.getOrThrow(decoder.feed(chunk));
    drain();
  }
  decoder.end();
  drain();
  expect(decoder.bufferedBytes).toBe(0);
  return values;
};

export const failure = <A>(result: Result.Result<A, ProtocolError>): ProtocolError => {
  if (Result.isSuccess(result)) throw new Error("Expected protocol failure");
  expect(result.failure).toBeInstanceOf(ProtocolError);
  return result.failure;
};

export const malformed = (wire: Uint8Array, options?: Partial<RespDecodeLimits>): ProtocolError => {
  const decoder = Result.getOrThrow(makeRespDecoder(options));
  const fed = decoder.feed(wire);
  if (Result.isFailure(fed)) return fed.failure;
  decoder.end();
  while (true) {
    const result = decoder.next();
    if (Result.isFailure(result)) {
      expect(failure(decoder.next())).toBe(result.failure);
      expect(failure(decoder.feed(new Uint8Array()))).toBe(result.failure);
      expect(decoder.bufferedBytes).toBe(0);
      return result.failure;
    }
    if (result.success === undefined) throw new Error("Expected malformed frame");
  }
};
