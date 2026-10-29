import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { makeCredentialBindings } from "#/credentials/Bindings";
import { decodeRedisConfig } from "#/RedisConfig";
import { hasOwnedRead, ownedWrite, ownRead, ownWrite } from "#/transport/Ownership";
import { Transport } from "#/transport/Transport";
import { bytes } from "#test/support/connection/Controlled";
import { makeControlledTransport } from "#test/support/transport/ControlledTransport";

it.effect(
  "credential retirement wakes an outstanding read and partial write and fences later I/O",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeControlledTransport();
      const transport = yield* Transport.pipe(Effect.provide(fixture.layer));
      const bindings = yield* makeCredentialBindings(transport);
      const config = yield* decodeRedisConfig({
        endpoint: { host: "localhost" },
        protocol: "resp2",
      });
      const connection = yield* bindings.transport.open(config);
      const read = yield* Effect.forkChild(Effect.result(connection.read));
      const write = yield* Effect.forkChild(Effect.result(connection.write(bytes("request"))));
      const attempt = yield* fixture.nextWrite;
      yield* attempt.accept(1);

      yield* connection.close;

      expect(yield* Fiber.join(read)).toMatchObject({
        _tag: "Failure",
        failure: { stage: "read", reason: "closed" },
      });
      expect(yield* Fiber.join(write)).toMatchObject({
        _tag: "Failure",
        failure: { stage: "write", reason: "closed" },
      });
      expect(yield* Effect.flip(connection.read)).toMatchObject({
        stage: "read",
        reason: "closed",
      });
      expect(yield* Effect.flip(connection.write(bytes("later")))).toMatchObject({
        stage: "write",
        reason: "closed",
      });
      expect((yield* fixture.observations).acceptedBytes).toBe(1);
    }),
);

it.effect("native ownership survives credential wrapping without bypassing retirement", () =>
  Effect.gen(function* () {
    let reads = 0;
    let writes = 0;
    const bindings = yield* makeCredentialBindings({
      open: () =>
        Effect.succeed({
          read: ownRead(
            Effect.sync(() => {
              reads++;
              return bytes("+OK\r\n");
            }),
          ),
          write: ownWrite(
            () => Effect.die(new Error("Unexpected copying write")),
            () =>
              Effect.sync(() => {
                writes++;
              }),
          ),
          close: Effect.void,
        }),
    });
    const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" } });
    const connection = yield* bindings.transport.open(config);
    expect(hasOwnedRead(connection.read)).toBe(true);
    const write = ownedWrite(connection.write);

    yield* write(bytes("request"));
    yield* connection.read;
    yield* connection.close;

    expect(yield* Effect.flip(write(bytes("later")))).toMatchObject({
      stage: "write",
      reason: "closed",
    });
    expect(yield* Effect.flip(connection.read)).toMatchObject({ stage: "read", reason: "closed" });
    expect({ reads, writes }).toEqual({ reads: 1, writes: 1 });
  }),
);
