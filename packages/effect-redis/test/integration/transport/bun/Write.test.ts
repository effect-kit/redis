import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { loopback } from "#test/support/networking/SocketServer";
import { runBun } from "#test/support/runtime/bun/Process";

it.live("BUN-WRITE: a slow reader observes every byte of a backpressured native send", () =>
  Effect.gen(function* () {
    const size = 16 * 1024 * 1024;
    let received = 0;
    let valid = true;
    const peer = yield* loopback((socket) => {
      socket.pause();
      const timer = setTimeout(() => socket.resume(), 100);
      socket.once("close", () => clearTimeout(timer));
      socket.on("data", (bytes) => {
        for (const byte of bytes) {
          valid &&= byte === received % 251;
          received++;
        }
        if (received === size) socket.write(new Uint8Array([1]));
      });
    });

    const receipt = yield* runBun({
      scenario: "transport",
      operation: "write",
      size,
      config: { endpoint: { host: "127.0.0.1", port: peer.port } },
    });

    expect(receipt.checks).toContain("backpressured-write");
    expect(received).toBe(size);
    expect(valid).toBe(true);
  }),
);

it.live("BUN-WRITE: interrupting a stalled native write retires the physical socket", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.pause());

    const receipt = yield* runBun({
      scenario: "transport",
      operation: "cancel-write",
      size: 16 * 1024 * 1024,
      config: { endpoint: { host: "127.0.0.1", port: peer.port } },
    });

    expect(receipt.checks).toContain("retired-physical-socket");
    (yield* peer.first).resume();
  }),
);
