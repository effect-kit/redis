import { existsSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Result } from "effect";

import { connect } from "../../../src/node.js";
import { encodeCommand } from "../../../src/protocol/encode.js";
import { decodeRedisConfig } from "../../../src/RedisConfig.js";
import { exchange } from "../../support/networking/Exchange.js";
import { faultProxy } from "../../support/networking/FaultProxy.js";
import {
  containerExists,
  FixtureContainer,
  scopedContainer,
} from "../../support/servers/Containers.js";
import { allocateServer, dockerServer, serverTargets } from "../../support/servers/DockerServer.js";

const redis = serverTargets.find((target) => target.fixture === "redis");
if (redis === undefined) throw new Error("Missing primary Redis fixture");

it.live("SOCKET-23: fault proxy holds and fragments actual Redis replies", () =>
  Effect.gen(function* () {
    const server = yield* dockerServer(redis);
    const proxy = yield* faultProxy(server.port, { holdReplies: true, fragmentBytes: 1 });
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: proxy.port } }),
    );
    const reply = yield* Effect.forkChild(exchange(connection, ["PING"]));
    yield* proxy.firstReply;
    expect(reply.pollUnsafe()).toBeUndefined();
    yield* proxy.releaseReplies;
    expect(yield* Fiber.join(reply)).toEqual({
      _tag: "SimpleString",
      value: new TextEncoder().encode("PONG"),
    });
    expect(proxy.failures).toEqual([]);
  }),
);

it.live("SOCKET-24: fault proxy cuts an established connection with a held reply", () =>
  Effect.gen(function* () {
    const server = yield* dockerServer(redis);
    const proxy = yield* faultProxy(server.port, { holdReplies: true });
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: proxy.port } }),
    );
    yield* connection.write(yield* Effect.fromResult(encodeCommand(["PING"])));
    const reply = yield* Effect.forkChild(Effect.result(connection.read));
    yield* proxy.firstReply;
    expect(reply.pollUnsafe()).toBeUndefined();
    yield* proxy.cut;
    const outcome = yield* Fiber.join(reply);
    if (Result.isSuccess(outcome)) expect(outcome.success).toBeUndefined();
    else {
      expect(outcome.failure.stage).toBe("read");
      expect(["closed", "io"]).toContain(outcome.failure.reason);
    }
  }),
);

it.live("SOCKET-25: failed readiness removes the already-created container and state", () =>
  Effect.gen(function* () {
    const failed = yield* Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* allocateServer(redis, {
          extraConfig: ["requirepass synthetic-fixture-password"],
          readinessMillis: 200,
        });
        return {
          name: fixture.name,
          directory: fixture.directory,
          result: yield* Effect.result(fixture.start),
        };
      }),
    );
    expect(Result.isFailure(failed.result) && failed.result.failure.stage).toBe("server-readiness");
    expect(yield* containerExists(failed.name)).toBe(false);
    expect(existsSync(failed.directory)).toBe(false);
  }),
);

it.live("SOCKET-26: canceled fixture startup awaits container removal and state cleanup", () =>
  Effect.gen(function* () {
    const allocated = yield* Deferred.make<{ readonly name: string; readonly directory: string }>();
    const opening = yield* Effect.forkChild(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* allocateServer(redis, {
            extraConfig: ["requirepass synthetic-fixture-password"],
          });
          yield* Deferred.succeed(allocated, fixture);
          return yield* fixture.start;
        }),
      ),
    );
    const fixture = yield* Effect.raceFirst(Deferred.await(allocated), Fiber.join(opening));
    yield* Fiber.interrupt(opening);
    expect(yield* containerExists(fixture.name)).toBe(false);
    expect(existsSync(fixture.directory)).toBe(false);
  }),
);

it.live("SOCKET-34: proxy request pause resumes without dropping buffered bytes", () =>
  Effect.gen(function* () {
    const server = yield* dockerServer(redis);
    const proxy = yield* faultProxy(server.port, { pauseRequests: true });
    const connection = yield* connect(
      yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: proxy.port } }),
    );
    const reply = yield* Effect.forkChild(exchange(connection, ["PING"]));
    yield* proxy.firstPausedRequest;
    expect(reply.pollUnsafe()).toBeUndefined();
    yield* proxy.resumeRequests;
    expect(yield* Fiber.join(reply)).toEqual({
      _tag: "SimpleString",
      value: new TextEncoder().encode("PONG"),
    });
  }),
);

it.live(
  "SOCKET-36: failed Testcontainers start removes a container before any handle returns",
  () =>
    Effect.gen(function* () {
      const container = new FixtureContainer(redis.reference).withEntrypoint([
        "/missing-fixture-executable",
      ]);
      const result = yield* Effect.scoped(Effect.result(scopedContainer(container)));
      expect(Result.isFailure(result) && result.failure.stage).toBe("container-start");
      expect(yield* containerExists(container.fixtureName)).toBe(false);
    }),
);
