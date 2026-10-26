import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";

import { makeConnection } from "#/connection/Connection";
import { decodeRedisConfig } from "#/RedisConfig";
import {
  controlled,
  reconnecting,
  sent,
  waitForSnapshot,
} from "#test/support/connection/Controlled";

it.effect("stress: partial writes and fragmented coalesced replies retain FIFO ownership", () =>
  Effect.gen(function* () {
    for (let round = 0; round < 40; round++) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { connection, fixture } = yield* controlled();
          const fibers = [];
          for (let index = 0; index < 8; index++) {
            fibers.push(
              yield* Effect.forkChild(connection.executeOrdinary(["INCR", `counter-${index}`])),
            );
            const write = yield* fixture.nextWrite;
            const split = 1 + ((round + index) % (write.bytes.length - 1));
            yield* write.accept(split);
            yield* Effect.yieldNow;
            yield* write.accept(write.bytes.length - split);
          }
          const replies = new TextEncoder().encode(
            Array.from({ length: 8 }, (_, index) => `:${round * 8 + index}\r\n`).join(""),
          );
          const width = 1 + (round % 13);
          for (let offset = 0; offset < replies.length; offset += width)
            yield* fixture.receive(replies.subarray(offset, offset + width));
          const results = yield* Effect.forEach(fibers, Fiber.join);

          expect(results).toEqual(
            Array.from({ length: 8 }, (_, index) => ({
              _tag: "Integer",
              value: BigInt(round * 8 + index),
            })),
          );
          yield* waitForSnapshot(connection, (snapshot) => snapshot.inFlightBytes === 0);
          expect(yield* connection.snapshot).toMatchObject({
            inFlightCommands: 0,
            queuedCommands: 0,
            inFlightBytes: 0,
          });
        }),
      );
    }
  }),
);

it.effect(
  "stress: written mutation loss fails unsent siblings and only future work reconnects",
  () =>
    Effect.gen(function* () {
      for (let round = 0; round < 30; round++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const fixture = yield* reconnecting();
            const [first, next] = fixture.fixtures;
            if (first === undefined || next === undefined)
              return yield* Effect.die("Missing fixture");
            const config = yield* decodeRedisConfig({
              endpoint: { host: "localhost" },
              protocol: "resp2",
              limits: { maxInFlightCommands: 1 },
            });
            const connection = yield* makeConnection(config, { reconnectAttempts: 1 }).pipe(
              Effect.provide(fixture.layer),
            );
            const mutation = yield* Effect.forkChild(
              Effect.result(connection.executeOrdinary(["INCR", "counter"])),
            );
            yield* sent(first, ["INCR", "counter"]);
            const queued = yield* Effect.forkChild(
              Effect.result(connection.executeOrdinary(["INCR", "queued"])),
            );
            yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
            yield* first.end;
            const outcomes = yield* Effect.forEach([mutation, queued], Fiber.join);

            expect(
              outcomes.map((result) =>
                Result.isFailure(result) && "delivery" in result.failure
                  ? result.failure.delivery
                  : "unexpected",
              ),
            ).toEqual(["possibly-written", "unsent"]);
            const future = yield* Effect.forkChild(connection.executeOrdinary(["PING"]));
            yield* sent(next, ["PING"], "+PONG\r\n");
            yield* Fiber.join(future);
            expect(fixture.opens()).toBe(2);
            expect(yield* first.written).toHaveLength(1);
            expect(yield* next.written).toHaveLength(1);
          }),
        );
      }
    }),
);
