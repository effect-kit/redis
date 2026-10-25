import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";

import { makeConnection } from "#/connection/Connection";
import { connect, layer } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { waitForSnapshot } from "#test/support/connection/Controlled";
import { exchange } from "#test/support/networking/Exchange";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { allocateServer, dockerServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { selectedEngine, serverTargets } from "#tools/FixtureTargets";

const targets = serverTargets.filter(
  (target) =>
    (target.fixture === "redis" || target.fixture === "valkey") &&
    (selectedEngine === "all" || target.product === selectedEngine),
);
const bytes = (text: string) => new TextEncoder().encode(text);

it.live.each(targets)(
  "CONNECTION-03: $fixture executes a mutation once despite reply loss and reconnect",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const proxy = yield* faultProxy(server.port, { holdReplies: true, fragmentBytes: 1 });
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: proxy.port },
        protocol: "resp2",
        limits: { maxInFlightCommands: 1 },
      });
      const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
      const key = `effect-redis:test:${randomUUID()}`;
      const mutation = yield* Effect.forkChild(
        Effect.result(connection.executeOrdinary(["INCR", key])),
      );
      yield* proxy.firstReply;
      const queued = yield* Effect.forkChild(
        Effect.result(connection.executeOrdinary(["INCR", `${key}:unsent`])),
      );
      yield* waitForSnapshot(connection, (snapshot) => snapshot.queuedCommands === 1);
      const oracle = yield* connect(
        yield* decodeRedisConfig({ endpoint: { host: "127.0.0.1", port: server.port } }),
      );
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
      yield* proxy.cut;
      const outcome = yield* Fiber.join(mutation);
      expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
        generation: 1,
      });
      const notSent = yield* Fiber.join(queued);
      expect(Result.isFailure(notSent) && notSent.failure).toMatchObject({
        _tag: "ConnectionError",
        delivery: "unsent",
        generation: 1,
      });
      yield* proxy.releaseReplies;
      expect(yield* connection.executeOrdinary(["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("1"),
      });
      expect((yield* exchange(oracle, ["GET", `${key}:unsent`]))._tag).toBe("Null");
      const snapshot = yield* connection.snapshot;
      expect(snapshot).toMatchObject({
        generation: 2,
        unknownOutcomes: 1,
        inFlightCommands: 0,
        queuedCommands: 0,
      });
      yield* recordFixture(`${target.fixture}-replay`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        configurationDigest: server.configurationDigest,
        snapshot,
        checks: [
          "independent state proved INCR executed once",
          "reply loss classified uncertain",
          "queued mutation stayed unsent",
          "generation 2 GET proved no replay",
        ],
        scope: "real state observation; no command replay",
      });
    }),
);

it.live.each(targets)(
  "CONNECTION-04: $fixture ACL denial during bootstrap fails acquisition",
  (target) =>
    Effect.gen(function* () {
      const server = yield* (yield* allocateServer(target, {
        extraConfig: ["user limited on >synthetic-acl-fixture ~* +ping"],
      })).start;
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: server.port },
        credentials: { username: "limited", password: "synthetic-acl-fixture" },
        clientName: "denied-by-acl",
      });
      const result = yield* Effect.result(makeConnection(config).pipe(Effect.provide(layer)));
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "HandshakeError",
        stage: "name",
        reason: "rejected",
      });
    }),
);
