import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Admission } from "#/connection/Admission";
import type { Ticket } from "#/connection/Admission";
import { takeWriteGroup } from "#/connection/WriteGroup";
import { decodeRedisConfig } from "#/RedisConfig";

it.effect("write groups respect byte limits and never combine unrelated ordinary requests", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const admission = new Admission(config.limits);
    const group = Symbol();
    const reserve = (key: string) => {
      const ticket = admission.reserve(["SET", key, "x".repeat(33_000)], 0, 1000);
      if (!("result" in ticket)) throw ticket;
      ticket.writeGroup = group;
      return ticket;
    };
    const first = reserve("a");
    const second = reserve("b");
    const queue = [first, second];
    const pending: Ticket[] = [];

    expect(takeWriteGroup(queue, pending, admission, 0)?.tickets).toEqual([first]);
    expect(queue).toEqual([second]);
    expect(admission.inFlightBytes).toBe(first.bytes);
    expect(takeWriteGroup(queue, pending, admission, 0)?.tickets).toEqual([second]);

    const a = admission.reserve(["GET", "a"], 0, 1000);
    const b = admission.reserve(["GET", "b"], 0, 1000);
    if (!("result" in a) || !("result" in b)) return yield* Effect.die("Expected admission");
    const ordinary = [a, b];
    expect(takeWriteGroup(ordinary, pending, admission, 0)?.tickets).toEqual([a]);
    expect(ordinary).toEqual([b]);
  }),
);

it.effect("a group preserves each command's ownership and uses the earliest deadline", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const admission = new Admission(config.limits);
    const first = admission.reserve(["GET", "a"], 0, 1000);
    const second = admission.reserve(["GET", "b"], 10, 100);
    if (!("result" in first) || !("result" in second))
      return yield* Effect.die("Expected admission");
    const identity = Symbol();
    first.writeGroup = identity;
    second.writeGroup = identity;
    const pending: Ticket[] = [];
    const group = takeWriteGroup([first, second], pending, admission, 20);

    expect(group?.deadlineMillis).toBe(110);
    expect(pending).toEqual([first, second]);
    expect(admission.inFlightCommands).toBe(2);
    expect(first.phase).toBe("writing");
    expect(second.phase).toBe("writing");
    first.frame?.fill(0);
    expect(group?.frame[0]).toBe(42);
  }),
);

it.effect("group selection reserves byte capacity for every ticket before copying or writing", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      limits: { maxInFlightBytes: 21 },
    });
    const admission = new Admission(config.limits);
    const first = admission.reserve(["GET", "a"], 0, 1000);
    const second = admission.reserve(["GET", "b"], 0, 1000);
    if (!("result" in first) || !("result" in second))
      return yield* Effect.die("Expected admission");
    first.writeGroup = second.writeGroup = Symbol();
    const queue = [first, second];
    const pending: Ticket[] = [];

    expect(takeWriteGroup(queue, pending, admission, 0)?.tickets).toEqual([first]);
    expect(takeWriteGroup(queue, pending, admission, 0)).toBeUndefined();
    expect(queue).toEqual([second]);
    expect(admission.inFlightBytes).toBe(first.bytes);

    admission.release(first);
    expect(takeWriteGroup(queue, pending, admission, 1)?.tickets).toEqual([second]);
  }),
);
