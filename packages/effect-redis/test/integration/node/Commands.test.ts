import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";

import { pingMetadata } from "../../../src/commands/connection/Ping.js";
import {
  CommandExecutor,
  Commands,
  Connection,
  Redis,
  RedisKey,
  decodeRedisConfig,
  defineCommand,
  Reply,
} from "../../../src/index.js";
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
const cases = targets.flatMap((target) =>
  ["resp2", "resp3"].map((protocol) => ({ target, protocol })),
);
const bytes = (text: string) => new TextEncoder().encode(text);
it.live.each(cases)(
  "COMMAND-24: $target.fixture $protocol typed service agrees with independent server state",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const endpoint = { host: "127.0.0.1", port: server.port };
      const config = yield* decodeRedisConfig({ endpoint, protocol });
      const oracle = yield* connect(yield* decodeRedisConfig({ endpoint }));
      const live = Redis.layer.pipe(
        Layer.provide(CommandExecutor.layer),
        Layer.provide(Connection.layer(config)),
        Layer.provide(layer),
      );
      const prefix = `effect-redis:test:${randomUUID()}`;
      yield* Effect.gen(function* () {
        const redis = yield* Redis;
        yield* redis.ping();
        expect(yield* redis.get(`${prefix}:missing`)).toEqual(Option.none());
        yield* redis.set(`${prefix}:empty`, "");
        expect(yield* redis.get(`${prefix}:empty`)).toEqual(Option.some(""));
        const binaryKey = new Uint8Array([...bytes(prefix), 0, 255]);
        const binaryValue = new Uint8Array([0, 255, 128, 13, 10]);
        yield* redis.set(binaryKey, binaryValue);
        expect(yield* redis.getBytes(binaryKey)).toEqual(Option.some(binaryValue));
        expect(yield* exchange(oracle, ["GET", binaryKey])).toEqual({
          _tag: "BlobString",
          value: binaryValue,
        });
        expect(yield* Effect.flip(redis.get(binaryKey))).toMatchObject({
          _tag: "ReplyError",
          expected: "text",
          delivery: "replied",
        });
        yield* exchange(oracle, ["SET", `${prefix}:count`, "9007199254740992"]);
        expect(yield* redis.incr(`${prefix}:count`)).toBe(9007199254740993n);
        expect(yield* exchange(oracle, ["GET", `${prefix}:count`])).toEqual({
          _tag: "BlobString",
          value: bytes("9007199254740993"),
        });
        yield* exchange(oracle, ["SET", `${prefix}:max`, "9223372036854775807"]);
        expect(yield* Effect.flip(redis.incr(`${prefix}:max`))).toMatchObject({
          _tag: "ServerError",
          code: "ERR",
          delivery: "replied",
        });
        expect(yield* exchange(oracle, ["GET", `${prefix}:max`])).toEqual({
          _tag: "BlobString",
          value: bytes("9223372036854775807"),
        });
        yield* exchange(oracle, ["ZADD", `${prefix}:scores`, "0.12345678901234568", "member"]);
        expect(yield* redis.zscore(`${prefix}:scores`, "member")).toEqual(
          Option.some(0.12345678901234568),
        );
        const rawScore = yield* exchange(oracle, ["ZSCORE", `${prefix}:scores`, "member"]);
        if (rawScore._tag !== "BlobString") return yield* Effect.die("Expected RESP2 score blob");
        expect(yield* redis.zscoreToken(`${prefix}:scores`, "member")).toEqual(
          Option.some(new TextDecoder().decode(rawScore.value)),
        );
        expect(yield* redis.zscore(`${prefix}:scores`, "absent")).toEqual(Option.none());
        expect(yield* Effect.flip(redis.get(`${prefix}:scores`))).toMatchObject({
          _tag: "ServerError",
          code: "WRONGTYPE",
        });
        const key = RedisKey.json(
          `${prefix}:user`,
          Schema.Struct({ name: Schema.String, count: Schema.Int }),
        );
        yield* redis.setKey(key, { name: "fixture", count: 3 });
        expect(yield* redis.getKey(key)).toEqual(Option.some({ name: "fixture", count: 3 }));
        expect(yield* exchange(oracle, ["GET", key.name])).toEqual({
          _tag: "BlobString",
          value: bytes('{"name":"fixture","count":3}'),
        });
        yield* exchange(oracle, ["SET", key.name, "invalid-json"]);
        expect(yield* Effect.flip(redis.getKey(key))).toMatchObject({
          _tag: "PayloadError",
          stage: "decode",
        });
        const echo = defineCommand({
          metadata: { ...pingMetadata, name: "ECHO" },
          tokens: ["ECHO", "value"],
          routing: { _tag: "Keyless" },
          decode: Reply.integer,
        });
        expect(yield* Effect.flip(redis.execute(echo))).toMatchObject({
          _tag: "ReplyError",
          expected: "integer",
          delivery: "replied",
        });
        const raw = yield* redis.raw(["EFFECT_REDIS_UNKNOWN_FIXTURE"], {
          execution: "ordinary",
          routing: { _tag: "Keyless" },
        });
        expect(raw._tag).toBe("SimpleError");
        expect(yield* redis.execute(Commands.getBytes(`${prefix}:empty`))).toEqual(
          Option.some(new Uint8Array()),
        );
        yield* redis.ping();
      }).pipe(Effect.provide(live));
      yield* recordFixture(`${target.fixture}-typed-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        build: server.build,
        configurationDigest: server.configurationDigest,
        protocol,
        commands: ["PING", "GET", "SET", "INCR", "ZSCORE"],
        checks: [
          "actual Layers",
          "independent state oracle",
          "binary and strict UTF-8",
          "int64 overflow and precision",
          "score token fidelity",
          "Schema payloads",
          "distinct server/decoder/payload failures",
          "custom decoder validation",
        ],
        scope: "Phase 05 vertical slice; no complete command-family or provider certification",
      });
    }),
);
