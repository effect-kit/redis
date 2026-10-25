import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { absent, atLeast, backend, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";

it.live.each(primaryCases)(
  "CORE-KEYS: $target.fixture $protocol expiry, serialization and indirect sort keys",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, oracle, prefix } = yield* backend(target, protocol);
      const source = `${prefix}:source`;
      const destination = `${prefix}:destination`;

      expect(yield* redis.ttl(source)).toBe(-2n);
      expect(yield* redis.pttl(source)).toBe(-2n);
      yield* redis.set(source, new Uint8Array([0, 255]));
      expect(yield* redis.type(source)).toBe("string");
      expect(yield* redis.exists([source, source, destination])).toBe(2n);
      expect(yield* redis.touch([source, destination])).toBe(1n);
      expect(yield* redis.ttl(source)).toBe(-1n);
      expect(yield* redis.expire(source, 60)).toBe(true);
      expect(yield* redis.pttl(source)).toBeGreaterThan(0n);
      expect(yield* redis.pexpire(source, 120000)).toBe(true);
      expect(yield* redis.expireat(source, 4102444800n)).toBe(true);
      expect(yield* redis.pexpireat(source, 4102444800000n)).toBe(true);
      expect(yield* redis.persist(source)).toBe(true);

      if (target.product === "valkey" || atLeast(target.version, "7.0.0")) {
        expect(yield* redis.expiretime(source)).toBe(-1n);
        expect(yield* redis.pexpiretime(destination)).toBe(-2n);
        expect(yield* redis.expire(source, 60, "NX")).toBe(true);
        expect(yield* redis.expire(source, 1, "NX")).toBe(false);
      } else {
        for (const name of ["EXPIRETIME", "PEXPIRETIME"]) yield* absent(oracle, name);
        expect(yield* Effect.flip(redis.expiretime(source))).toMatchObject({ _tag: "ServerError" });
        expect(yield* Effect.flip(redis.pexpiretime(source))).toMatchObject({
          _tag: "ServerError",
        });
        expect(yield* Effect.flip(redis.expire(source, 60, "NX"))).toMatchObject({
          _tag: "ServerError",
        });
      }

      expect(yield* redis.copy(source, destination)).toBe(true);
      expect(yield* redis.copy(source, destination)).toBe(false);
      expect(yield* redis.renamenx(destination, source)).toBe(false);
      yield* redis.rename(destination, `${destination}:renamed`);
      expect(yield* redis.getBytes(`${destination}:renamed`)).toEqual(
        Option.some(new Uint8Array([0, 255])),
      );
      const serialized = yield* redis.dump(source);
      expect(Option.isSome(serialized)).toBe(true);
      if (Option.isSome(serialized)) {
        yield* redis.restore(`${destination}:restored`, 0, serialized.value);
        expect(yield* redis.getBytes(`${destination}:restored`)).toEqual(
          Option.some(new Uint8Array([0, 255])),
        );
      }

      yield* redis.set(`${prefix}:move`, "other-db");
      expect(yield* redis.move(`${prefix}:move`, 1)).toBe(true);
      expect(yield* redis.get(`${prefix}:move`)).toEqual(Option.none());
      expect(yield* redis.randomkey()).toMatchObject({ _tag: "Some" });
      expect(yield* redis.keys(`${prefix}:*`)).toEqual(expect.arrayContaining([bytes(source)]));
      expect(yield* redis.objectEncoding(source)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.objectIdletime(source)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.objectRefcount(source)).toMatchObject({ _tag: "Some" });
      expect(yield* redis.objectHelp()).not.toHaveLength(0);
      expect(yield* Effect.flip(redis.objectFreq(source))).toMatchObject({ _tag: "ServerError" });

      const list = `${prefix}:list`;
      yield* redis.rpush(list, ["2", "1"]);
      // oxlint-disable-next-line unicorn/no-array-sort -- Redis SORT is a remote command, not Array.sort.
      expect(yield* redis.sort(list)).toEqual([Option.some(bytes("1")), Option.some(bytes("2"))]);
      expect(yield* redis.sortStore(list, `${prefix}:sorted`)).toBe(2n);
      yield* redis.mset([
        [`${prefix}:weight:1`, "10"],
        [`${prefix}:weight:2`, "20"],
      ]);
      expect(
        yield* redis.sort(list, { by: `${prefix}:weight:*`, get: ["#", `${prefix}:weight:*`] }),
      ).toEqual([
        Option.some(bytes("1")),
        Option.some(bytes("10")),
        Option.some(bytes("2")),
        Option.some(bytes("20")),
      ]);
      if (target.product === "valkey" || atLeast(target.version, "7.0.0"))
        expect(yield* redis.sortRo(list)).toHaveLength(2);
      else {
        yield* absent(oracle, "SORT_RO");
        expect(yield* Effect.flip(redis.sortRo(list))).toMatchObject({ _tag: "ServerError" });
      }

      expect(yield* redis.unlink([source, `${prefix}:missing`])).toBe(1n);
      expect(yield* redis.del([`${destination}:renamed`, `${destination}:restored`])).toBe(2n);
      expect(yield* exchange(oracle, ["EXISTS", source])).toEqual({ _tag: "Integer", value: 0n });
    }),
);
