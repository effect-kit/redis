import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import { Network, getContainerRuntimeClient } from "testcontainers";

import { containerRequest, requireImage } from "#test/support/servers/Containers";
import { imageReference, reaperImage } from "#test/support/servers/Targets";

/** Register the network name before acquisition so failed starts also have an owner. */
export const fixtureNetwork = Effect.gen(function* () {
  yield* requireImage(imageReference(reaperImage));
  const client = yield* containerRequest("network-runtime", getContainerRuntimeClient);
  const name = `effect-redis-${randomUUID()}`;
  yield* Effect.acquireRelease(Effect.succeed(name), (owned) =>
    containerRequest("network-remove", async () => {
      try {
        await client.network.remove(client.network.getById(owned));
      } catch (cause) {
        if (
          typeof cause !== "object" ||
          cause === null ||
          !("statusCode" in cause) ||
          cause.statusCode !== 404
        )
          throw cause;
      }
    }).pipe(Effect.orDie),
  );

  return yield* containerRequest("network-start", () =>
    new Network({ nextUuid: () => name }).start(),
  ).pipe(Effect.uninterruptible);
});
