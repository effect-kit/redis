import { existsSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Redacted, Result } from "effect";

import { connect } from "../../../src/node.js";
import { encodeCommand } from "../../../src/protocol/encode.js";
import { decodeRedisConfig } from "../../../src/RedisConfig.js";
import { exchange } from "../../support/networking/Exchange.js";
import { faultProxy } from "../../support/networking/FaultProxy.js";
import { command } from "../../support/servers/Command.js";
import { allocateServer, dockerServer, serverTargets } from "../../support/servers/DockerServer.js";
import { unixRuntimeSmoke } from "../../support/servers/UnixRuntime.js";
import { certificates } from "../../support/tls/Certificates.js";

it.live.each(serverTargets)(
  "SOCKET-21: real $fixture pinned build exchanges PING and binary ECHO",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const connection = yield* connect(
        yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: server.port } }),
      );
      expect(yield* exchange(connection, ["PING"])).toEqual({
        _tag: "SimpleString",
        value: new TextEncoder().encode("PONG"),
      });
      const modules = yield* exchange(connection, ["MODULE", "LIST"]);
      expect(modules._tag).toBe("Array");
      const observed: Record<string, string> = {};
      if (modules._tag === "Array")
        for (const module of modules.values) {
          expect(module._tag).toBe("Array");
          if (module._tag !== "Array") continue;
          const name = module.values[1];
          const version = module.values[3];
          expect(name?._tag).toBe("BlobString");
          expect(version?._tag).toBe("Integer");
          if (name?._tag === "BlobString" && version?._tag === "Integer")
            observed[new TextDecoder().decode(name.value)] = String(version.value);
        }
      expect(observed).toEqual(target.modules);
      const payload = new Uint8Array(200_000);
      for (let index = 0; index < payload.length; index++) payload[index] = index % 256;
      expect(yield* exchange(connection, ["ECHO", payload])).toEqual({
        _tag: "BlobString",
        value: payload,
      });
      expect(server.build).toContain(`v=${target.version} `);
      expect(server.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
    }),
);

it.live.each(
  serverTargets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"),
)("SOCKET-22: real $fixture verifies mutual TLS and exchanges PING", (target) =>
  Effect.gen(function* () {
    const identity = yield* certificates();
    const server = yield* dockerServer(target, identity);
    const connection = yield* connect(
      yield* decodeRedisConfig({
        endpoint: {
          host: "127.0.0.1",
          port: server.port,
          tls: {
            ca: identity.ca,
            serverName: "redis.test",
            certificate: identity.clientCertificate,
            privateKey: Redacted.value(identity.clientKey),
          },
        },
      }),
    );
    expect(yield* exchange(connection, ["PING"])).toEqual({
      _tag: "SimpleString",
      value: new TextEncoder().encode("PONG"),
    });
  }),
);

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
    expect(
      yield* command("docker", ["ps", "--all", "--quiet", "--filter", `name=^${failed.name}$`]),
    ).toBe("");
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
    expect(
      yield* command("docker", ["ps", "--all", "--quiet", "--filter", `name=^${fixture.name}$`]),
    ).toBe("");
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

it.live.each(
  serverTargets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"),
)("SOCKET-35: compiled Node runtime exchanges PING/ECHO with real $fixture over Unix", (target) =>
  Effect.gen(function* () {
    const result = yield* unixRuntimeSmoke(target);
    expect(result).toEqual({ node: "24.22.0", transport: "unix", exchanges: 2 });
  }),
);
