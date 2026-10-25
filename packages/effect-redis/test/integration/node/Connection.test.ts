import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";

import { Connection, makeConnection } from "../../../src/connection/Connection.js";
import { connect, layer } from "../../../src/node.js";
import { decodeRedisConfig } from "../../../src/RedisConfig.js";
import { selectedEngine, serverTargets } from "../../../tools/FixtureTargets.ts";
import { exchange } from "../../support/networking/Exchange.js";
import { allocateServer, dockerServer } from "../../support/servers/DockerServer.js";
import { recordFixture } from "../../support/servers/Evidence.js";
import { unixRuntimeSmoke } from "../../support/servers/UnixRuntime.js";
import { certificates } from "../../support/tls/Certificates.js";

const targets = serverTargets.filter(
  (target) => selectedEngine === "all" || target.product === selectedEngine,
);
const bytes = (text: string) => new TextEncoder().encode(text);

it.live.each(targets)(
  "CONNECTION-01: $fixture negotiated engine preserves concurrent ownership and integer precision",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: server.port },
      });
      const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
      const prefix = `effect-redis:test:${randomUUID()}`;
      yield* connection.executeOrdinary(["SET", prefix, "9007199254740992"]);
      expect(yield* connection.executeOrdinary(["INCR", prefix])).toEqual({
        _tag: "Integer",
        value: 9007199254740993n,
      });
      const results = yield* Effect.forEach(
        Array.from({ length: 64 }, (_, index) => index),
        (index) =>
          Effect.gen(function* () {
            const payload = new Uint8Array([index, 0, 255, 128, 13, 10]);
            expect(yield* connection.executeOrdinary(["ECHO", payload])).toEqual({
              _tag: "BlobString",
              value: payload,
            });
            return yield* connection.executeOrdinary(["INCR", `${prefix}:counter`]);
          }),
        { concurrency: 32 },
      );
      expect(results.every((reply) => reply._tag === "Integer")).toBe(true);
      const integers = results
        .flatMap((reply) => (reply._tag === "Integer" ? [reply.value] : []))
        .toSorted((a, b) => (a < b ? -1 : 1));
      expect(integers).toEqual(Array.from({ length: 64 }, (_, index) => BigInt(index + 1)));
      const wrongType = yield* connection.executeOrdinary(["SADD", prefix, "synthetic"]);
      expect(wrongType._tag).toBe("SimpleError");
      expect(yield* connection.executeOrdinary(["PING"])).toEqual({
        _tag: "SimpleString",
        value: bytes("PONG"),
      });
      const snapshot = yield* connection.snapshot;
      expect(snapshot).toMatchObject({
        queuedCommands: 0,
        queuedBytes: 0,
        inFlightCommands: 0,
        inFlightBytes: 0,
        unknownOutcomes: 0,
      });
      yield* connection.close;
      yield* recordFixture(`${target.fixture}-connection`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        build: server.build,
        configurationDigest: server.configurationDigest,
        protocol: snapshot.protocol,
        checks: [
          "HELLO negotiation",
          "64 concurrent binary/counter exchanges",
          "int64 above safe-number range",
          "server errors preserve sibling ownership",
          "bounded drain",
        ],
        scope: "ordinary connection engine only",
      });
    }),
);

it.live.each(targets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"))(
  "CONNECTION-02: $fixture authenticates over mTLS and applies name/database before admission",
  (target) =>
    Effect.gen(function* () {
      const tls = yield* certificates();
      const password = Redacted.make("synthetic-auth-fixture");
      const server = yield* (yield* allocateServer(target, { tls, password })).start;
      const endpoint = {
        host: "127.0.0.1",
        port: server.port,
        tls: {
          ca: tls.ca,
          serverName: "redis.test",
          certificate: tls.clientCertificate,
          privateKey: Redacted.value(tls.clientKey),
        },
      };
      const config = yield* decodeRedisConfig({
        endpoint,
        credentials: { password: Redacted.value(password) },
        database: 2,
        clientName: "effect-redis-fixture",
      });
      yield* Effect.gen(function* () {
        const connection = yield* Connection;
        expect(yield* connection.executeOrdinary(["CLIENT", "GETNAME"])).toEqual({
          _tag: "BlobString",
          value: bytes("effect-redis-fixture"),
        });
        const key = `effect-redis:test:${randomUUID()}`;
        yield* connection.executeOrdinary(["SET", key, "db-two"]);
        const oracle = yield* connect(yield* decodeRedisConfig({ endpoint }));
        yield* exchange(oracle, ["AUTH", Redacted.value(password)]);
        expect((yield* exchange(oracle, ["GET", key]))._tag).toBe("Null");
        yield* exchange(oracle, ["SELECT", "2"]);
        expect(yield* exchange(oracle, ["GET", key])).toEqual({
          _tag: "BlobString",
          value: bytes("db-two"),
        });
      }).pipe(Effect.provide(Connection.layer(config).pipe(Layer.provide(layer))));
    }),
);

it.live.each(targets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"))(
  "CONNECTION-05: $fixture compiled engine runs handshake and commands over Unix in a real Node process",
  (target) =>
    Effect.gen(function* () {
      expect(yield* unixRuntimeSmoke(target, "connection")).toEqual({
        node: "24.22.0",
        transport: "unix",
        exchanges: 2,
        engine: true,
      });
    }),
);
