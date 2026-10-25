import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { redirect } from "#/cluster/routing/Redirect";
import { decodeShards, decodeSlots, validateTopology } from "#/cluster/topology/Decode";
import type { RespValue } from "#/protocol/RespValue";

const text = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});
const integer = (value: number): RespValue => ({ _tag: "Integer", value: BigInt(value) });
const array = (...values: RespValue[]): RespValue => ({ _tag: "Array", values });
const error = (value: string): RespValue => ({
  _tag: "SimpleError",
  value: new TextEncoder().encode(value),
});
const fields = (pairs: ReadonlyArray<readonly [string, RespValue]>): RespValue => ({
  _tag: "Map",
  entries: pairs.map(([key, value]) => [text(key), value]),
});

it.effect("decodes legacy slot arrays, null hosts and replicas", () =>
  Effect.gen(function* () {
    const shards = yield* decodeSlots(
      array(
        array(
          integer(0),
          integer(16383),
          array(text(""), integer(6379), text("primary")),
          array(text("replica"), integer(6380), text("replica-id")),
        ),
      ),
      "seed",
    );
    yield* validateTopology(shards, 2);

    expect(shards[0]?.primary.address).toEqual({ host: "seed", port: 6379 });
    expect(shards[0]?.replicas[0]?.primaryId).toBe("primary");
  }),
);

it.effect("decodes SHARDS maps and selects the TLS endpoint port", () =>
  Effect.gen(function* () {
    const reply = array(
      fields([
        ["slots", array(integer(0), integer(16383))],
        [
          "nodes",
          array(
            fields([
              ["id", text("a")],
              ["role", text("master")],
              ["endpoint", text("redis.internal")],
              ["port", integer(6379)],
              ["tls-port", integer(6380)],
              ["health", text("online")],
            ]),
          ),
        ],
        ["future-field", integer(1)],
      ]),
    );
    const shards = yield* decodeShards(reply, "seed", true);
    yield* validateTopology(shards, 1);

    expect(shards[0]?.primary.address.port).toBe(6380);
  }),
);

it.effect("rejects gaps, overlaps and excess nodes before publishing a map", () =>
  Effect.gen(function* () {
    const shards = yield* decodeSlots(
      array(array(integer(0), integer(16383), array(text("host"), integer(6379), text("a")))),
      "seed",
    );

    const shard = shards[0];
    if (shard === undefined) return yield* Effect.die("Missing test shard");
    expect(
      (yield* Effect.result(validateTopology([{ ...shard, slots: [[1, 16383]] }], 2)))._tag,
    ).toBe("Failure");
    expect((yield* Effect.result(validateTopology([...shards, ...shards], 2)))._tag).toBe(
      "Failure",
    );
    expect((yield* Effect.result(validateTopology(shards, 0)))._tag).toBe("Failure");
  }),
);

for (const [wire, host, port] of [
  ["MOVED 123 host.example:6379", "host.example", 6379],
  ["ASK 0 :6380", "peer", 6380],
  ["MOVED 16383 [::1]:6379", "::1", 6379],
] as const) {
  it.effect(`parses bounded routing reply ${wire.split(" ")[0]} ${host}`, () =>
    Effect.gen(function* () {
      const parsed = yield* redirect(error(wire), { host: "peer", port: 1 });
      expect(parsed?.address).toEqual({ host, port });
    }),
  );
}

for (const wire of [
  "MOVED 16384 host:1",
  "ASK 0 host:0",
  "MOVED -1 host:1",
  "MOVED 1 host:70000",
  "MOVED 1 host:1 trailing",
]) {
  it.effect(`rejects malformed redirect ${wire}`, () =>
    Effect.gen(function* () {
      expect((yield* Effect.result(redirect(error(wire), { host: "peer", port: 1 })))._tag).toBe(
        "Failure",
      );
    }),
  );
}

it.effect("leaves ordinary application errors for the command decoder", () =>
  Effect.gen(function* () {
    expect(yield* redirect(error("WRONGTYPE payload"), { host: "peer", port: 1 })).toBeUndefined();
  }),
);
