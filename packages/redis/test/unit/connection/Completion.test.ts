import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { Admission } from "#/connection/Admission";
import { awaitReply } from "#/connection/Completion";
import { ConnectionError } from "#/errors/ConnectionError";
import { decodeRedisConfig } from "#/RedisConfig";

it.effect("a known reply remains available after a late transport failure", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const admission = new Admission(config.limits);
    const ticket = admission.reserve(["INCR", "counter"], 0, 1000);
    if (!("result" in ticket)) return yield* ticket;

    admission.begin(ticket, 0);
    admission.succeed(ticket, { _tag: "Integer", value: 1n });
    admission.fail(
      ticket,
      new ConnectionError({ reason: "transport", delivery: "unsent", generation: 1 }),
    );

    expect(yield* awaitReply(ticket)).toEqual({ _tag: "Integer", value: 1n });
    expect(admission.inFlightBytes).toBe(0);
  }),
);

it.effect("acquisition waiters and later observers receive the same exact failure", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const admission = new Admission(config.limits);
    const ticket = admission.reserve(["PING"], 0, 1000);
    if (!("result" in ticket)) return yield* ticket;

    const first = yield* Effect.forkChild(Effect.flip(awaitReply(ticket)));
    const second = yield* Effect.forkChild(Effect.flip(awaitReply(ticket)));
    yield* Effect.yieldNow;

    const failure = new ConnectionError({ reason: "timeout", delivery: "unsent", generation: 1 });
    admission.fail(ticket, failure);

    expect(yield* Fiber.join(first)).toBe(failure);
    expect(yield* Fiber.join(second)).toBe(failure);
    expect(yield* Effect.flip(awaitReply(ticket))).toBe(failure);
  }),
);
