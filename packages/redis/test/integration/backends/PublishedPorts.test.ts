import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";

import { Wait } from "testcontainers";

import { loopback } from "#test/support/networking/SocketServer";
import {
  containerExists,
  FixtureContainer,
  scopedContainer,
} from "#test/support/servers/Containers";
import { dockerServer } from "#test/support/servers/DockerServer";
import type { FixtureError } from "#test/support/servers/FixtureError";
import { probe } from "#test/support/servers/Readiness";
import { serverTargets } from "#test/support/servers/Targets";

const redis = serverTargets.find((target) => target.fixture === "redis");
if (redis === undefined) throw new Error("Missing primary Redis fixture");

/** Deliberately bypass safe allocation to reproduce the host/VM namespace mismatch. */
class CollidingContainer extends FixtureContainer {
  publishAt(host: number) {
    this.withExposedPorts({ container: 6379, host });
    this.hostConfig.PortBindings = {
      "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: String(host) }],
    };
    return this;
  }
}

const collisionAt = (host: number) =>
  new CollidingContainer(redis.reference)
    .withEntrypoint(["redis-server"])
    .withCommand([
      "--bind",
      "0.0.0.0",
      "--protected-mode",
      "no",
      "--save",
      "",
      "--appendonly",
      "no",
    ])
    .withTmpFs({ "/data": "rw,nosuid,size=32m" })
    .publishAt(host)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections tcp"));

const expectBindingCollision = (error: FixtureError) => {
  expect(error.stage).toBe("container-start");
  const failure = error.cause === undefined ? undefined : Redacted.value(error.cause);
  const cause =
    typeof failure === "object" &&
    failure !== null &&
    "cause" in failure &&
    Redacted.isRedacted(failure.cause)
      ? Redacted.value(failure.cause)
      : failure;
  expect(
    cause instanceof Error &&
      /(?:port is already allocated|address already in use)/i.test(cause.message),
  ).toBe(true);
};

it.live(
  "published ports: a VM may accept an occupied host port while Redis is already healthy",
  () =>
    Effect.gen(function* () {
      const occupied = yield* loopback((socket) =>
        socket.once("data", () => socket.end("-HOST-COLLISION\r\n")),
      );
      const result = yield* Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            const container = collisionAt(occupied.port);
            const started = yield* scopedContainer(container);
            const backend = yield* Effect.promise(() => started.exec(["redis-cli", "PING"]));
            expect(backend.exitCode).toBe(0);
            expect(backend.output.trim()).toBe("PONG");
            expect(started.getMappedPort(6379)).toBe(occupied.port);

            const host = yield* Effect.result(probe(occupied.port));
            expect(Result.isFailure(host) && host.failure.stage).toBe("readiness-reply");
            expect(occupied.counts().accepted).toBeGreaterThan(0);
          }),
        ),
      );

      // A shared host/daemon kernel correctly rejects the collision during start instead.
      if (Result.isFailure(result)) {
        expectBindingCollision(result.failure);
      }
    }),
);

it.live(
  "published ports: a daemon-side collision cleans the failed start without stopping its owner",
  () =>
    Effect.gen(function* () {
      const server = yield* dockerServer(redis);
      const collision = collisionAt(server.port);
      const result = yield* Effect.result(Effect.scoped(scopedContainer(collision)));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expectBindingCollision(result.failure);
      expect(yield* containerExists(collision.fixtureName)).toBe(false);
      yield* probe(server.port);
    }),
);

it.live(
  "published ports: host-side allocation avoids an occupied listener and releases both scopes",
  () =>
    Effect.gen(function* () {
      const occupied = yield* loopback((socket) =>
        socket.once("data", () => socket.end("-HOST-COLLISION\r\n")),
      );
      const server = yield* dockerServer(redis);

      expect(server.port).not.toBe(occupied.port);
      yield* probe(server.port);
      expect(occupied.counts().accepted).toBe(0);
    }),
);
