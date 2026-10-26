import { copyFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Redacted, Schedule } from "effect";

import { Wait } from "testcontainers";
import type { StartedNetwork } from "testcontainers";

import { FixtureContainer, requireImage, scopedContainer } from "#test/support/servers/Containers";
import { FixtureError } from "#test/support/servers/FixtureError";
import { imageReference, runtimeImage } from "#test/support/servers/Targets";
import { temporaryDirectory } from "#test/support/servers/TemporaryDirectory";

/** All configured inter-server data/bus links traverse this owned native Node proxy. */
export const peerProxy = Effect.fnUntraced(function* (network: StartedNetwork) {
  const reference = imageReference(runtimeImage);
  yield* requireImage(reference);
  const directory = yield* temporaryDirectory;
  yield* Effect.tryPromise({
    try: () =>
      copyFile(
        new URL("../../fixtures/networking/peer-proxy.mjs", import.meta.url),
        join(directory, "peer-proxy.mjs"),
      ),
    catch: (cause) => new FixtureError({ stage: "peer-proxy-copy", cause: Redacted.make(cause) }),
  });
  const container = new FixtureContainer(reference)
    .withEntrypoint(["node"])
    .withCommand(["/fixture/peer-proxy.mjs"])
    .withNetwork(network)
    .withBindMounts([{ source: directory, target: "/fixture", mode: "ro" }])
    .loopbackPort(18080)
    .withWaitStrategy(Wait.forAll([]));
  const started = yield* scopedContainer(container);
  const base = `http://127.0.0.1:${started.getMappedPort(18080)}`;
  const request = (path: string, method = "POST") =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(`${base}${path}`, { method, signal });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Proxy rejected control");
      },
      catch: (cause) =>
        new FixtureError({ stage: "peer-proxy-control", cause: Redacted.make(cause) }),
    });
  yield* request("/health", "GET").pipe(Effect.retry({ schedule: Schedule.spaced(50), times: 60 }));

  return {
    address: started.getIpAddress(network.getName()),
    cut: (index: number, source: string) =>
      request(`/cut/${index}?source=${encodeURIComponent(source)}`),
    heal: request("/heal"),
  };
});
