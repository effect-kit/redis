import { createConnection } from "node:net";

import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { makeConnection } from "#/transport/node/Connection";
import { loopback } from "#test/support/networking/SocketServer";

it.live("SOCKET-31: finalization removes owned native listeners and ignores stale readiness", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.resume());
    const socket = createConnection({ host: "127.0.0.1", port: peer.port });
    const events = ["connect", "readable", "error", "close"];
    const original = new Map(events.map((event) => [event, new Set(socket.listeners(event))]));

    const physical = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const connection = makeConnection(socket, "connect", 65536);
        const owned = new Map(
          events.map((event) => [
            event,
            socket.listeners(event).filter((listener) => !original.get(event)?.has(listener)),
          ]),
        );
        return { ...connection, owned };
      }),
      (connection) => connection.close,
    );

    yield* physical.ready;
    yield* physical.close;

    for (const event of events) {
      for (const listener of physical.owned.get(event) ?? [])
        expect(socket.listeners(event)).not.toContain(listener);
    }

    socket.emit("connect");
    socket.emit("readable");
    const result = yield* Effect.result(physical.connection.read);

    expect(Result.isFailure(result) && result.failure.reason).toBe("closed");
  }),
);

it.live(
  "SOCKET-32: an idle reader stays in bounded native readable mode and drains owned chunks",
  () =>
    Effect.gen(function* () {
      const payload = new Uint8Array(1024 * 1024).fill(17);
      const peer = yield* loopback((socket) => socket.end(payload));
      const socket = createConnection({ host: "127.0.0.1", port: peer.port });
      const physical = yield* Effect.acquireRelease(
        Effect.sync(() => makeConnection(socket, "connect", 65536)),
        (connection) => connection.close,
      );

      yield* physical.ready;
      yield* Effect.callback<void>((resume) => {
        if (socket.readableLength > 0) {
          resume(Effect.void);
          return;
        }
        const readable = () => resume(Effect.void);
        socket.once("readable", readable);
        return Effect.sync(() => {
          socket.off("readable", readable);
        });
      });

      expect(socket.readableFlowing).toBe(false);
      expect(socket.readableLength).toBeLessThanOrEqual(socket.readableHighWaterMark + 65536);

      let received = 0;
      while (true) {
        const bytes = yield* physical.connection.read;
        if (bytes === undefined) break;
        expect(bytes.constructor).toBe(Uint8Array);
        expect(bytes.length).toBeLessThanOrEqual(65536);
        expect(bytes.every((byte) => byte === 17)).toBe(true);
        received += bytes.length;
      }

      expect(received).toBe(payload.length);
    }),
);
