import { randomUUID } from "node:crypto";

import { expect } from "@effect/vitest";
import { Effect } from "effect";

import type { TransportConnection } from "#/transport/Transport";
import { exchange } from "#test/support/networking/Exchange";

export const readOnlySmoke = Effect.fnUntraced(function* (connection: TransportConnection) {
  expect(yield* exchange(connection, ["PING"])).toEqual({
    _tag: "SimpleString",
    value: new TextEncoder().encode("PONG"),
  });
  const payload = new Uint8Array([0, 255, 128, 13, 10]);
  expect(yield* exchange(connection, ["ECHO", payload])).toEqual({
    _tag: "BlobString",
    value: payload,
  });
});

/** Only disposable fixtures owned by this scope may call this mutating smoke. */
export const ownedServerSmoke = Effect.fnUntraced(function* (connection: TransportConnection) {
  const key = `effect-redis:test:${randomUUID()}`;
  const payload = new Uint8Array([0, 255, 128, 13, 10]);
  expect(yield* exchange(connection, ["SET", key, payload])).toEqual({
    _tag: "SimpleString",
    value: new TextEncoder().encode("OK"),
  });
  expect(yield* exchange(connection, ["GET", key])).toEqual({ _tag: "BlobString", value: payload });
  expect(yield* exchange(connection, ["DEL", key])).toEqual({ _tag: "Integer", value: 1n });
});
