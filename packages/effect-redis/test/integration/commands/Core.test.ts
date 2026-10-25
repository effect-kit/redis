import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { array, blob } from "#test/support/commands/CoreCase";
import { commandFixture, respond } from "#test/support/commands/Fixture";

it.effect(
  "CORE-REPLIES: a malformed completed vector reply fails without replay or retiring the socket",
  () =>
    Effect.gen(function* () {
      const { redis, fixture, connection } = yield* commandFixture();
      const failure = yield* respond(
        fixture,
        Effect.flip(redis.mget(["a", "b"])),
        ["MGET", "a", "b"],
        "*1\r\n$1\r\nv\r\n",
      );

      expect(failure).toMatchObject({
        _tag: "ReplyError",
        delivery: "replied",
        expected: "array-length",
      });
      yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
      expect((yield* connection.snapshot).generation).toBe(1);
      expect((yield* connection.snapshot).unknownOutcomes).toBe(0);
    }),
);

it.effect("CORE-GEO: prepared detail flags and decoder share an immutable snapshot", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const details = { distance: true };
    const prepared = yield* Commands.geosearchWith(
      "geo",
      { origin: { member: "a" }, area: { radius: 1, unit: "km" } },
      details,
    ).prepare;
    details.distance = false;

    const result = yield* respond(
      fixture,
      redis.executePrepared(prepared),
      ["GEOSEARCH", "geo", "FROMMEMBER", "a", "BYRADIUS", "1", "km", "WITHDIST"],
      "*1\r\n*2\r\n$1\r\na\r\n$1\r\n0\r\n",
    );
    expect(result[0]?.distance).toEqual(Option.some(0));
  }),
);

it.effect("CORE-REPLIES: prepared vector length does not follow later caller mutations", () =>
  Effect.gen(function* () {
    const keys: [string, ...string[]] = ["a", "b"];
    const prepared = yield* Commands.mget(keys).prepare;
    keys.push("c");

    expect(prepared.tokens).toEqual(["MGET", "a", "b"]);
    expect(yield* prepared.decode(array(blob("one"), blob("two")))).toHaveLength(2);
  }),
);

it.effect("CORE-GEO: lazy radius intent chooses metadata from its validated origin", () =>
  Effect.gen(function* () {
    const origin = { member: "old" };
    const command = Commands.georadiusStore("geo", "out", origin, 1, "km");
    Object.assign(origin, { longitude: 0, latitude: 0 });
    Reflect.deleteProperty(origin, "member");

    const prepared = yield* command.prepare;

    expect(prepared.metadata.name).toBe("GEORADIUS");
    expect(prepared.tokens).toEqual(["GEORADIUS", "geo", "0", "0", "1", "km", "STORE", "out"]);
  }),
);
