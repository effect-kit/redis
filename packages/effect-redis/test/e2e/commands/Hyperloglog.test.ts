import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { backend, primaryCases } from "#test/support/commands/Backend";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-HYPERLOGLOG: $target.fixture $protocol approximate counting and merge",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const a = `${prefix}:a`;
      const b = `${prefix}:b`;
      const out = `${prefix}:out`;

      expect(yield* redis.pfadd(a)).toBe(true);
      expect(yield* redis.pfcount([a])).toBe(0n);
      yield* redis.pfadd(a, ["a", "b", new Uint8Array([0, 255])]);
      yield* redis.pfadd(b, ["b", "c"]);
      yield* redis.pfmerge(out, [a, b]);
      const estimate = yield* redis.pfcount([out]);

      // This checks a small deterministic fixture; it is not an accuracy promise for arbitrary inputs.
      expect(estimate).toBeGreaterThanOrEqual(3n);
      expect(estimate).toBeLessThanOrEqual(5n);
      expect(yield* redis.pfcount([a, b])).toBe(estimate);
      expect(yield* exchange(oracle, ["PFCOUNT", out])).toEqual({
        _tag: "Integer",
        value: estimate,
      });
    }),
);
