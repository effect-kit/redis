import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Inspectable, Redacted, Stream } from "effect";

import { decodeRedisConfig, makeRedisMonitor } from "#/index";
import { layer } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "MONITOR: $target.fixture $protocol isolated, redacted diagnostic stream",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { config, redis, prefix, server } = yield* sessionBackend(target, protocol);
      const monitor = yield* makeRedisMonitor(config).pipe(Effect.provide(layer));
      const key = `${prefix}:monitor`;
      const capture = yield* Effect.forkChild(
        Stream.runCollect(
          monitor.events.pipe(
            Stream.filter(
              (record) =>
                record._tag === "Command" && Redacted.value(record.commandLine).includes(key),
            ),
            Stream.take(2),
          ),
        ),
      );

      yield* redis.set(key, new Uint8Array([0, 255]));
      yield* redis.getBytes(key);
      const events = yield* Fiber.join(capture);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ _tag: "Command", database: 0n });
      expect(events[0]?._tag === "Command" && Redacted.value(events[0].commandLine)).toContain(
        "\\xff",
      );
      expect(Inspectable.toStringUnknown(events)).not.toContain(key);
      yield* monitor.close;
      yield* redis.ping();

      yield* recordFixture(`phase10-monitor-${target.fixture}-${protocol}`, {
        fixture: target.fixture,
        version: target.version,
        image: target.reference,
        protocol,
        build: server.build,
        configurationDigest: server.configurationDigest,
        scenarios: ["MONITOR", "MODE-ISOLATION", "REDACTION"],
      });
    }),
);

it.live.each(primaryCases)(
  "MONITOR: $target.fixture $protocol fragmented bytes and explicit disconnect failure",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { server, redis, prefix } = yield* sessionBackend(target, protocol);
      const proxy = yield* faultProxy(server.port, { fragmentBytes: 1 });
      const config = yield* decodeRedisConfig({
        endpoint: { host: "127.0.0.1", port: proxy.port },
        protocol,
      });
      const monitor = yield* makeRedisMonitor(config).pipe(Effect.provide(layer));
      const key = `${prefix}:fragmented-monitor`;
      const capture = yield* Effect.forkChild(
        Stream.runCollect(
          monitor.events.pipe(
            Stream.filter(
              (record) =>
                record._tag === "Command" && Redacted.value(record.commandLine).includes(key),
            ),
            Stream.take(1),
          ),
        ),
      );

      yield* redis.set(key, "value");
      expect(yield* Fiber.join(capture)).toHaveLength(1);
      yield* proxy.cut;
      expect(yield* Effect.flip(Stream.runDrain(monitor.events))).toMatchObject({
        _tag: "ConnectionError",
      });
      yield* monitor.close;
      yield* redis.ping();
    }),
);
