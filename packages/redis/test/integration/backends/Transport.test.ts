import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { connect } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { exchange } from "#test/support/networking/Exchange";
import { ownedServerSmoke } from "#test/support/networking/Smoke";
import { dockerServer, serverTargets } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { selectedEngine } from "#test/support/servers/Targets";
import { unixRuntimeSmoke } from "#test/support/servers/UnixRuntime";
import { certificates } from "#test/support/tls/Certificates";

const targets = serverTargets.filter(
  (target) => selectedEngine === "all" || target.product === selectedEngine,
);

it.live.each(targets)(
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

      if (target.moduleList === "unsupported") {
        const reply = yield* exchange(connection, ["MODULE", "LIST"]);
        expect(reply._tag).toBe("SimpleError");
        if (reply._tag === "SimpleError")
          expect(new TextDecoder().decode(reply.value)).toMatch(/unknown|unsupported/i);
      } else if (target.modules !== undefined) {
        const modules = yield* exchange(connection, ["MODULE", "LIST"]);
        expect(modules._tag).toBe("Array");
        const observed: Record<string, string> = {};
        if (modules._tag === "Array")
          for (const module of modules.values) {
            expect(module._tag).toBe("Array");
            if (module._tag !== "Array") continue;
            const name = module.values[1];
            const version = module.values[3];
            expect(["SimpleString", "BlobString"]).toContain(name?._tag);
            expect(version?._tag).toBe("Integer");
            if (
              (name?._tag === "BlobString" || name?._tag === "SimpleString") &&
              version?._tag === "Integer"
            )
              observed[new TextDecoder().decode(name.value)] = String(version.value);
          }
        expect(observed).toEqual(target.modules);
      }

      const payload = new Uint8Array(200_000);
      for (let index = 0; index < payload.length; index++) payload[index] = index % 256;

      expect(yield* exchange(connection, ["ECHO", payload])).toEqual({
        _tag: "BlobString",
        value: payload,
      });

      yield* ownedServerSmoke(connection);
      expect(server.build).toContain(target.version);
      expect(server.configurationDigest).toMatch(/^[a-f0-9]{64}$/);

      yield* recordFixture(target.fixture, {
        fixture: target.fixture,
        version: target.version,
        build: server.build,
        image: target.reference,
        configurationDigest: server.configurationDigest,
        modules: target.modules ?? null,
        moduleList: target.moduleList ?? "supported",
        transport: "tcp",
        protocol: "RESP2",
        checks: [
          "PING",
          "binary ECHO 200000 bytes",
          "isolated binary SET/GET/DEL",
          "MODULE LIST profile",
        ],
        scope: "transport smoke; complete command and provider certification pending",
      });
    }),
);

it.live.each(targets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"))(
  "SOCKET-22: real $fixture verifies mutual TLS and exchanges PING",
  (target) =>
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

it.live.each(targets.filter((target) => target.fixture === "redis" || target.fixture === "valkey"))(
  "SOCKET-35: compiled Node runtime exchanges PING/ECHO with real $fixture over Unix",
  (target) =>
    Effect.gen(function* () {
      const result = yield* unixRuntimeSmoke(target);

      expect(result).toEqual({ node: "24.22.0", transport: "unix", exchanges: 2 });
    }),
);
