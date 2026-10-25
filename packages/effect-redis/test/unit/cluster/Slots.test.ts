import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { commandSlot, sameSlot } from "#/cluster/routing/Route";
import { keySlot } from "#/cluster/Slot";
import * as Commands from "#/commands/index";

it("uses independent Redis CRC16-XMODEM vectors", () => {
  expect(keySlot("123456789")).toBe(0x31c3);
  expect(keySlot("foo")).toBe(12182);
  expect(keySlot("bar")).toBe(5061);
  expect(keySlot("")).toBe(0);
});

it("hashes exact tag bytes and preserves the first-brace empty-tag rule", () => {
  expect(keySlot("a{foo}b")).toBe(12182);
  expect(keySlot("a{bar}{foo}")).toBe(5061);
  expect(keySlot("a{{foo}}b")).toBe(keySlot("{foo"));
  expect(keySlot("a{foo")).toBe(keySlot(new TextEncoder().encode("a{foo")));
  expect(keySlot("{}{foo}")).not.toBe(12182);
  expect(keySlot(new Uint8Array([0, 123, 255, 0, 125, 128]))).toBe(
    keySlot(new Uint8Array([255, 0])),
  );
  expect(keySlot("é{東京}🚀")).toBe(keySlot("東京"));
});

it.effect("rejects cross-slot intent and accepts shared tags", () =>
  Effect.gen(function* () {
    expect(yield* sameSlot(["a{foo}", "b{foo}"])).toBe(12182);
    const result = yield* Effect.result(sameSlot(["foo", "bar"]));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason).toBe("cross-slot");
  }),
);

it.effect("uses descriptor key indexes for scripting, streams and destinations", () =>
  Effect.gen(function* () {
    const set = yield* Commands.set("a{foo}", "bar").prepare;
    expect(yield* commandSlot(set)).toBe(12182);

    const rename = yield* Commands.rename("a{foo}", "b{foo}").prepare;
    expect(yield* commandSlot(rename)).toBe(12182);
    const cross = yield* Commands.rename("foo", "bar").prepare;
    expect((yield* Effect.result(commandSlot(cross)))._tag).toBe("Failure");

    const publish = yield* Commands.spublish("events{foo}", "payload").prepare;
    expect(yield* commandSlot(publish)).toBe(12182);
  }),
);

it.effect("requires explicit targets for keyspace-wide and dynamic operations", () =>
  Effect.gen(function* () {
    const scan = yield* Commands.scan().prepare;
    const unresolved = yield* Commands.sort("a{foo}", { by: "weights:*" }).prepare;

    expect((yield* Effect.result(commandSlot(scan)))._tag).toBe("Failure");
    expect((yield* Effect.result(commandSlot(unresolved)))._tag).toBe("Failure");
    expect(yield* commandSlot(scan, true)).toBeUndefined();
    expect(yield* commandSlot(unresolved, true)).toBe(12182);
  }),
);
