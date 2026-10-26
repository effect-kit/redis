import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const keys = Effect.fnUntraced(function* ({
  redis,
  prefix,
  check,
  policy,
  raw,
  record,
}: Client) {
  const C = core.Commands;
  const source = `${prefix}:key`;
  const destination = `${source}:destination`;

  yield* check("keys.ttl-missing", C.ttl(source), -2n);
  yield* check("keys.pttl-missing", C.pttl(source), -2n);
  yield* redis.set(source, new Uint8Array([0, 255]));
  yield* check("keys.type", C.type(source), "string");
  yield* check("keys.exists-duplicates", C.exists([source, source, destination]), 2n);
  yield* check("keys.touch", C.touch([source, destination]), 1n);
  yield* check("keys.ttl-persistent", C.ttl(source), -1n);
  yield* check("keys.expire", C.expire(source, 60), true);
  yield* check("keys.pttl-live", C.pttl(source), (value) => assert.ok(value > 0n));
  yield* check("keys.pexpire", C.pexpire(source, 120000), true);
  yield* check("keys.expireat", C.expireat(source, 2000000000n), true);
  yield* check("keys.pexpireat", C.pexpireat(source, 2000000000000n), true);
  yield* check("keys.persist", C.persist(source), true);
  yield* check("keys.expiretime", C.expiretime(source), -1n);
  yield* check("keys.pexpiretime", C.pexpiretime(destination), -2n);

  yield* check("keys.copy", C.copy(source, destination), true);
  // A missing COPY must not alter the rest of the rename scenario.
  if (policy.unavailable.has("COPY")) yield* redis.set(destination, new Uint8Array([0, 255]));
  yield* check("keys.renamenx", C.renamenx(destination, source), false);
  yield* check("keys.rename", C.rename(destination, `${destination}:renamed`), undefined);
  assert.deepEqual(
    yield* redis.getBytes(`${destination}:renamed`),
    Option.some(new Uint8Array([0, 255])),
  );

  const serialized = yield* redis.dump(source);
  assert.ok(Option.isSome(serialized));
  yield* check("keys.restore", C.restore(`${source}:restored`, 0, serialized.value), undefined);
  assert.deepEqual(
    yield* redis.getBytes(`${source}:restored`),
    Option.some(new Uint8Array([0, 255])),
  );
  record("keys.dump", "DUMP");

  yield* redis.set(`${source}:move`, "other-db");
  yield* check("keys.move", C.move(`${source}:move`, 1), true);
  yield* check("keys.random", C.randomkey(), (value) => assert.ok(Option.isSome(value)));
  yield* check("keys.pattern", C.keys(`${prefix}:*`), (values) =>
    assert.ok(values.some((value) => Buffer.from(value).equals(bytes(source)))),
  );

  const list = `${source}:list`;
  yield* redis.rpush(list, ["2", "1"]);
  // oxlint-disable-next-line unicorn/no-array-sort -- This is the remote Redis command.
  yield* check("keys.sort", C.sort(list), [Option.some(bytes("1")), Option.some(bytes("2"))]);
  yield* check("keys.sort-store", C.sortStore(list, `${source}:sorted`), 2n);
  yield* check("keys.sort-ro", C.sortRo(list), [Option.some(bytes("1")), Option.some(bytes("2"))]);

  yield* check("keys.unlink", C.unlink([source, `${prefix}:missing`]), 1n);
  yield* check("keys.delete", C.del([`${destination}:renamed`, `${source}:restored`]), 2n);
  assert.deepEqual(yield* raw(["EXISTS", source]), { _tag: "Integer", value: 0n });
});
