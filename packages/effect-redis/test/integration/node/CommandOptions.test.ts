import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { decodeRedisConfig, makeConnection, makeExecutor, makeRedis } from "../../../src/index.js";
import type { SetExpiry } from "../../../src/index.js";
import { connect, layer } from "../../../src/node.js";
import { selectedEngine, serverTargets } from "../../../tools/FixtureTargets.ts";
import { exchange } from "../../support/networking/Exchange.js";
import { dockerServer } from "../../support/servers/DockerServer.js";
import { recordFixture } from "../../support/servers/Evidence.js";

const targets = serverTargets.filter(
  (target) =>
    ["redis", "valkey"].includes(target.product) &&
    (selectedEngine === "all" || target.product === selectedEngine),
);
const bytes = (text: string) => new TextEncoder().encode(text);
it.live.each(targets)(
  "COMMAND-25: $fixture SET options preserve conditional, expiry and version semantics",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: server.port },
      });
      const connection = yield* makeConnection(config).pipe(Effect.provide(layer));
      const redis = makeRedis(makeExecutor(connection));
      const oracle = yield* connect(config);
      const key = `effect-redis:test:${randomUUID()}`;
      expect(yield* redis.set(key, "initial", { condition: "NX" })).toBe(true);
      expect(yield* redis.set(key, "wrong", { condition: "NX" })).toBe(false);
      expect(yield* exchange(oracle, ["GET", key])).toEqual({
        _tag: "BlobString",
        value: bytes("initial"),
      });
      expect(yield* redis.set(key, "updated", { condition: "XX" })).toBe(true);
      expect(yield* redis.set(`${key}:missing`, "wrong", { condition: "XX" })).toBe(false);
      expect(yield* redis.set(key, "old-request", { get: true })).toEqual(
        Option.some(bytes("updated")),
      );
      const supportsNxGet = target.product === "valkey" || !target.version.startsWith("6.");
      if (supportsNxGet) {
        expect(yield* redis.set(key, "must-not-write", { get: true, condition: "NX" })).toEqual(
          Option.some(bytes("old-request")),
        );
        expect(yield* exchange(oracle, ["GET", key])).toEqual({
          _tag: "BlobString",
          value: bytes("old-request"),
        });
      } else
        expect(
          yield* Effect.flip(redis.set(key, "must-not-write", { get: true, condition: "NX" })),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
      const time = yield* exchange(oracle, ["TIME"]);
      if (time._tag !== "Array") return yield* Effect.die("Expected server TIME tuple");
      const [seconds, micros] = time.values;
      if (seconds?._tag !== "BlobString" || micros?._tag !== "BlobString")
        return yield* Effect.die("Expected server TIME byte strings");
      // Absolute expiry is measured against the server clock, including inside Docker VMs.
      const now =
        Number(new TextDecoder().decode(seconds.value)) * 1000 +
        Math.floor(Number(new TextDecoder().decode(micros.value)) / 1000);
      const expiries: ReadonlyArray<SetExpiry> = [
        { type: "EX", value: 120 },
        { type: "PX", value: 120000n },
        { type: "EXAT", value: Math.floor(now / 1000) + 120 },
        { type: "PXAT", value: now + 120000 },
      ];
      for (const expiry of expiries) {
        yield* redis.set(key, "ttl", { expiry });
        const ttl = yield* exchange(oracle, ["PTTL", key]);
        if (ttl._tag !== "Integer") return yield* Effect.die("Expected integer PTTL");
        expect(ttl.value).toBeGreaterThan(0n);
        expect(ttl.value).toBeLessThanOrEqual(120000n);
        yield* redis.set(key, "keep", { expiry: { type: "KEEPTTL" } });
        const kept = yield* exchange(oracle, ["PTTL", key]);
        if (kept._tag !== "Integer") return yield* Effect.die("Expected integer PTTL");
        expect(kept.value).toBeGreaterThan(0n);
        expect(kept.value).toBeLessThanOrEqual(ttl.value);
      }
      yield* redis.set(key, "already-expired", { expiry: { type: "PXAT", value: 1 } });
      expect(yield* redis.get(key)).toEqual(Option.none());
      yield* redis.set(key, "compare");
      const supportsIfeq =
        (target.product === "redis" && target.fixture === "redis") ||
        (target.product === "valkey" && target.fixture === "valkey");
      if (supportsIfeq) {
        expect(
          yield* redis.set(key, "wrong", { condition: { type: "IFEQ", value: "mismatch" } }),
        ).toBe(false);
        expect(
          yield* redis.set(key, "matched", { condition: { type: "IFEQ", value: "compare" } }),
        ).toBe(true);
      } else
        expect(
          yield* Effect.flip(
            redis.set(key, "wrong", { condition: { type: "IFEQ", value: "compare" } }),
          ),
        ).toMatchObject({ _tag: "ServerError", code: "ERR" });
      if (target.fixture === "redis") {
        expect(
          yield* redis.set(key, "new", { condition: { type: "IFNE", value: "mismatch" } }),
        ).toBe(true);
        const digest = yield* exchange(oracle, ["DIGEST", key]);
        if (digest._tag !== "BlobString") return yield* Effect.die("Expected digest blob");
        const token = new TextDecoder().decode(digest.value);
        expect(
          yield* redis.set(key, "digest-match", { condition: { type: "IFDEQ", digest: token } }),
        ).toBe(true);
        expect(
          yield* redis.set(key, "digest-differs", { condition: { type: "IFDNE", digest: token } }),
        ).toBe(true);
      } else {
        for (const type of ["IFNE", "IFDEQ", "IFDNE"] as const) {
          const condition =
            type === "IFNE" ? { type, value: "compare" } : { type, digest: "0123456789abcdef" };
          expect(yield* Effect.flip(redis.set(key, "wrong", { condition }))).toMatchObject({
            _tag: "ServerError",
            code: "ERR",
          });
        }
      }
      yield* redis.ping();
      yield* recordFixture(`${target.fixture}-typed-options`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        build: server.build,
        configurationDigest: server.configurationDigest,
        protocol: (yield* connection.snapshot).protocol,
        checks: [
          "NX/XX",
          "GET old value without applied-status inference",
          "EX/PX/EXAT/PXAT/KEEPTTL",
          "past absolute expiry",
          "IFEQ version differences",
          "Redis-only IFNE/digest conditions",
        ],
        availability: {
          nxGet: supportsNxGet,
          ifeq: supportsIfeq,
          ifneDigest: target.fixture === "redis",
        },
        scope: "observed SET option scenarios; no brand-wide capability inference",
      });
    }),
);
