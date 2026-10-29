import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Admission } from "#/connection/Admission";
import type { Ticket } from "#/connection/Admission";
import { takeWriteGroup } from "#/connection/WriteGroup";
import type { RedisCommand } from "#/protocol/encode";
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

it.effect(
  "batch admission shares bounded slabs and rejects the entire batch before registration",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        limits: { maxQueuedCommands: 3, maxInFlightCommands: 2 },
      });
      const admission = new Admission(config.limits);
      const tickets = admission.reserveBatch(
        [
          ["GET", "a"],
          ["GET", "b"],
          ["GET", "c"],
        ],
        0,
        1000,
      );
      if (!Array.isArray(tickets)) return yield* Effect.die(tickets);
      const [first, second, third] = tickets;
      if (!first?.frame || !second?.frame || !third?.frame)
        return yield* Effect.die("Missing frames");
      expect(first.frame.buffer).toBe(second.frame.buffer);
      expect(third.frame.buffer).not.toBe(second.frame.buffer);
      const group = takeWriteGroup([...tickets], [], admission, 0);
      if (group === undefined) return yield* Effect.die("Missing write group");
      expect(group.frame.buffer).toBe(first.frame.buffer);
      expect(group.tickets).toHaveLength(2);

      const rejected = new Admission(config.limits);
      expect(
        rejected.reserveBatch(
          [
            ["GET", "a"],
            ["GET", "b"],
            ["GET", "c"],
            ["GET", "d"],
          ],
          0,
          1000,
        ),
      ).toMatchObject({ reason: "count" });
      expect(rejected.tickets.size).toBe(0);
      expect(
        rejected.reserveBatch([["GET", "a"], [] as unknown as RedisCommand], 0, 1000),
      ).toMatchObject({
        kind: "InvalidArguments",
      });
      expect(rejected.tickets.size).toBe(0);
    }),
);

it.effect("a partial slab remains charged until its last ticket releases the storage", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      limits: { maxQueuedBytes: 64, maxInFlightBytes: 64 },
    });
    const admission = new Admission(config.limits);
    const tickets = admission.reserveBatch(
      [
        ["GET", "a"],
        ["GET", "b"],
      ],
      0,
      1000,
    );
    if (!Array.isArray(tickets)) return yield* Effect.die(tickets);
    const [first, second] = tickets;
    if (!first || !second) return yield* Effect.die("Missing tickets");
    takeWriteGroup([...tickets], [], admission, 0);
    admission.release(first);
    const queued = admission.reserveBatch(
      [
        ["GET", "c"],
        ["GET", "d"],
        ["GET", "e"],
      ],
      0,
      1000,
    );
    if (!Array.isArray(queued)) return yield* Effect.die(queued);
    takeWriteGroup([...queued], [], admission, 0);
    const [queuedFirst] = queued;
    if (!queuedFirst) return yield* Effect.die("Missing queued ticket");
    admission.release(queuedFirst);
    expect(admission.reserve(["GET", "f".repeat(11)], 0, 1000)).toMatchObject({ reason: "bytes" });
    admission.release(second);
    expect(admission.reserve(["GET", "f".repeat(11)], 0, 1000)).toHaveProperty("result");
  }),
);
