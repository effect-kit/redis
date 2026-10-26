import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { encodeFloat32 } from "#/index";
import { moduleBackend, moduleCases } from "#test/support/modules/Backend";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(moduleCases)(
  "MODULE-VECTOR: $fixture.id $protocol typed vectors and option-dependent replies",
  ({ fixture, protocol }) =>
    Effect.gen(function* () {
      const { redis, prefix, server, observed } = yield* moduleBackend(fixture, protocol);
      const key = `${prefix}:vectors`;
      const one = new Uint8Array([0, 255, 1]);
      const vector = { _tag: "Values" as const, coordinates: [1, 0, 0] as const };

      if (fixture.id !== "redis-modules") {
        expect(yield* Effect.flip(redis.vadd(key, vector, one))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
        });
      } else {
        expect(yield* redis.vcard(key)).toBe(0n);
        expect(yield* redis.vemb(key, one)).toEqual(Option.none());
        expect(
          yield* redis.vadd(key, vector, one, {
            quantization: "NOQUANT",
            attributes: '{"kind":"one"}',
            connections: 8,
            ef: 10,
          }),
        ).toBe(true);
        expect(
          yield* redis.vadd(key, { _tag: "FP32", bytes: yield* encodeFloat32([0, 1, 0]) }, "two", {
            quantization: "NOQUANT",
            connections: 8,
          }),
        ).toBe(true);
        expect(yield* redis.vdim(key)).toBe(3n);
        expect(yield* redis.vcard(key)).toBe(2n);
        expect(yield* redis.vismember(key, one)).toBe(true);
        expect(yield* redis.vemb(key, one)).toEqual(Option.some([1, 0, 0]));
        expect(Option.isSome(yield* redis.vembRaw(key, one))).toBe(true);
        expect(Option.isSome(yield* redis.vinfo(key))).toBe(true);
        expect(Option.isSome(yield* redis.vlinks(key, one))).toBe(true);
        expect(Option.isSome(yield* redis.vlinksWithScores(key, one))).toBe(true);
        expect(
          yield* redis.vsim(
            key,
            { _tag: "Element", element: one },
            { count: 1, truth: true, noThread: true },
          ),
        ).toEqual([one]);
        const scores = yield* redis.vsimWithScores(key, vector, { count: 1, epsilon: 1, ef: 10 });
        expect(scores[0]?.[0]).toEqual(one);
        expect(scores[0]?.[1]).toBeCloseTo(1);
        expect((yield* redis.vsimWithAttributes(key, vector, { count: 1 }))[0]?.[1]).toEqual(
          Option.some(new TextEncoder().encode('{"kind":"one"}')),
        );
        expect(
          (yield* redis.vsimWithScoresAndAttributes(key, vector, {
            count: 1,
            filter: '.kind == "one"',
            filterEf: 100,
          }))[0]?.element,
        ).toEqual(one);
        expect(yield* redis.vsetattr(key, one, "")).toBe(true);
        expect(yield* redis.vgetattr(key, one)).toEqual(Option.none());
        expect(yield* redis.vsetattr(key, one, '{"x":1}')).toBe(true);
        expect(Option.isSome(yield* redis.vgetattr(key, one))).toBe(true);
        expect(Option.isSome(yield* redis.vrandmember(key))).toBe(true);
        expect((yield* redis.vrandmemberCount(key, -4)).length).toBe(4);
        expect((yield* redis.vrange(key, "-", "+", 10)).length).toBe(2);
        expect(
          yield* Effect.flip(redis.vadd(key, { _tag: "Values", coordinates: [1, 0] }, "wrong")),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
        expect(yield* redis.vrem(key, one)).toBe(true);
        expect(yield* redis.vismember(key, one)).toBe(false);
      }

      yield* recordFixture(`module-vectors-${fixture.id}-${protocol}`, {
        protocol,
        observed,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: ["binary-elements", "fp32", "score-attribute-variants", "missing-family"],
      });
    }),
  90_000,
);
