import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";

import { makeConnection } from "#/connection/Connection";
import { decodeRedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";
import { bytes, reconnecting } from "#test/support/connection/Controlled";

it.effect("local retirement fences admission before the reader observes native close", () =>
  Effect.gen(function* () {
    const fixtures = yield* reconnecting();
    const [first, second] = fixtures.fixtures;
    if (first === undefined || second === undefined) return yield* Effect.die("Missing fixture");
    const transport = yield* Transport.pipe(Effect.provide(fixtures.layer));
    let retired = false;
    let opens = 0;
    const layer = Layer.succeed(Transport, {
      open: (config) =>
        transport.open(config).pipe(
          Effect.map((physical) => {
            if (++opens !== 1) return physical;
            // Reproduce Bun's close/read scheduling gap without relying on host timing.
            return { ...physical, isRetired: () => retired, read: Effect.never };
          }),
        ),
    });
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol: "resp2" });
    const connection = yield* makeConnection(config).pipe(Effect.provide(layer));

    retired = true;
    const request = yield* connection.executeOrdinary(["PING"]).pipe(Effect.forkChild);
    const written = yield* Effect.race(
      first.nextWrite.pipe(Effect.map((attempt) => ({ owner: "retired", attempt }))),
      second.nextWrite.pipe(Effect.map((attempt) => ({ owner: "replacement", attempt }))),
    );

    expect(written.owner).toBe("replacement");
    yield* written.attempt.accept(written.attempt.bytes.length);
    yield* second.receive(bytes("+PONG\r\n"));
    expect((yield* Fiber.join(request))._tag).toBe("SimpleString");
    expect((yield* first.observations).closed).toBe(1);
    expect(opens).toBe(2);
  }),
);
