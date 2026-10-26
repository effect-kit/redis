import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { loopback } from "#test/support/networking/SocketServer";
import { awaitReadiness, probe } from "#test/support/servers/Readiness";
import type { ReadinessObservation } from "#test/support/servers/Readiness";

it.live("readiness retries early empty closes and accepts a fragmented PONG", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const observations: ReadinessObservation[] = [];
    const peer = yield* loopback((socket) => {
      attempts++;
      socket.once("data", () => {
        if (attempts < 4) socket.end();
        else socket.write("+PO", () => socket.end("NG\r\n"));
      });
    });
    yield* awaitReadiness(
      probe(peer.port, undefined, undefined, (observation) => observations.push(observation)),
    );

    expect(observations.map((observation) => observation.outcome)).toEqual([
      "empty-close",
      "empty-close",
      "empty-close",
      "ready",
    ]);
    expect(observations.map((observation) => observation.receivedBytes)).toEqual([0, 0, 0, 7]);
  }),
);

it.live("readiness rejects arbitrary replies without exporting their bytes", () =>
  Effect.gen(function* () {
    const observations: ReadinessObservation[] = [];
    const peer = yield* loopback((socket) =>
      socket.once("data", () => socket.end("-private-payload\r\n")),
    );
    const result = yield* Effect.result(
      probe(peer.port, undefined, undefined, (observation) => observations.push(observation)),
    );

    expect(Result.isFailure(result) && result.failure.stage).toBe("readiness-reply");
    expect(observations[0]?.outcome).toBe("invalid-reply");
    expect(JSON.stringify(observations)).not.toContain("private-payload");
  }),
);
