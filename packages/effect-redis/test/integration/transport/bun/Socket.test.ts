import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { loopback } from "#test/support/networking/SocketServer";
import { runBun } from "#test/support/runtime/bun/Process";
import { recordFixture } from "#test/support/servers/Evidence";

it.live(
  "BUN-SOCKET: binary bytes, reader cancellation and connection churn use actual Bun",
  () =>
    Effect.gen(function* () {
      const peer = yield* loopback((socket) => socket.on("data", (bytes) => socket.write(bytes)));
      const config = { endpoint: { host: "127.0.0.1", port: peer.port } };

      for (const operation of ["echo", "cancel-read", "churn"] as const) {
        const receipt = yield* runBun({ scenario: "transport", config, operation });
        expect(receipt.bun).toBe("1.4.4");
        yield* recordFixture(`bun-socket-${operation}`, receipt);
      }

      expect(peer.counts().accepted).toBe(66);
      expect(peer.counts().closed).toBe(66);
    }),
  45_000,
);

it.live("BUN-SOCKET: clean EOF retains a fragmented large payload", () =>
  Effect.gen(function* () {
    const size = 1024 * 1024;
    const peer = yield* loopback((socket) => socket.end(new Uint8Array(size).fill(17)));

    const receipt = yield* runBun({
      scenario: "transport",
      operation: "read",
      size,
      config: { endpoint: { host: "127.0.0.1", port: peer.port } },
    });

    expect(receipt.checks).toContain("drain-before-eof");
  }),
);

it.live("BUN-SOCKET: acquisition cleanup joins late native sockets and refused connections", () =>
  Effect.gen(function* () {
    const peer = yield* loopback((socket) => socket.resume());
    const config = { endpoint: { host: "127.0.0.1", port: peer.port } };

    const late = yield* runBun({ scenario: "transport", operation: "late-open", config });
    expect(late.checks).toContain("joined-acquisition");
    expect(peer.counts()).toEqual({ accepted: 1, closed: 1 });
    yield* peer.close;

    const refused = yield* runBun({ scenario: "transport", operation: "open-error", config });
    expect(refused.checks).toContain("open-failure");
  }),
);
