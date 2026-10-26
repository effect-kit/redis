import assert from "node:assert/strict";

import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const arrays = Effect.fnUntraced(function* ({ prefix, check }: Client) {
  const C = core.Commands;
  const key = `${prefix}:array`;

  yield* check("arrays.count-empty", C.arcount(key), 0n);
  yield* check("arrays.set", C.arset(key, 2, ["a", "b"]), 2n);
  yield* check("arrays.length", C.arlen(key), 4n);
  yield* check("arrays.count", C.arcount(key), 2n);
  yield* check("arrays.missing-slot", C.arget(key, 0), Option.none());
  yield* check(
    "arrays.mset",
    C.armset(key, [
      [0, "1"],
      [1, "2"],
    ]),
    2n,
  );
  yield* check("arrays.range", C.argetrange(key, 0, 3), [
    Option.some(bytes("1")),
    Option.some(bytes("2")),
    Option.some(bytes("a")),
    Option.some(bytes("b")),
  ]);
  yield* check("arrays.mget", C.armget(key, [3, 99]), [Option.some(bytes("b")), Option.none()]);
  yield* check("arrays.grep", C.argrep(key, "-", "+", [{ type: "EXACT", value: "a" }]), [2n]);
  yield* check(
    "arrays.grep-values",
    C.argrepWithValues(key, "-", "+", [{ type: "GLOB", value: "a*" }]),
    [[2n, bytes("a")]],
  );
  yield* check("arrays.aggregate", C.arop(key, 0, 3, "SUM"), Option.some("3"));
  yield* check("arrays.aggregate-integer", C.aropInteger(key, 0, 3, "USED"), Option.some(4n));
  yield* check("arrays.match", C.aropMatch(key, 0, 3, "a"), 1n);
  yield* check("arrays.delete", C.ardel(key, [3]), 1n);
  yield* check("arrays.delete-range", C.ardelrange(key, [[2, 2]]), 1n);
  yield* check("arrays.seek", C.arseek(key, 10), true);
  yield* check("arrays.next", C.arnext(key), Option.some(10n));
  yield* check("arrays.insert", C.arinsert(key, ["x", "y"]), 11n);
  yield* check("arrays.last", C.arlastitems(key, 2), [
    Option.some(bytes("x")),
    Option.some(bytes("y")),
  ]);
  yield* check("arrays.ring", C.arring(`${key}:ring`, 2, ["a", "b", "c"]), 0n);
  yield* check("arrays.info", C.arinfo(key), (value) => assert.equal(value.count, 4n));
  yield* check("arrays.scan", C.arscan(key, 0, 1), [
    [0n, bytes("1")],
    [1n, bytes("2")],
  ]);

  const high = 9223372036854775810n;
  yield* check("arrays.unsigned-seek", C.arseek(key, high), true);
  yield* check("arrays.unsigned-insert", C.arinsert(key, [new Uint8Array([0, 255])]), high);
  yield* check("arrays.unsigned-next", C.arnext(key), Option.some(high + 1n));
});
