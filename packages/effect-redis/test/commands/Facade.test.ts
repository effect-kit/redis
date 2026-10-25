import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";

import { CommandExecutor } from "#/command/Executor";
import { pingMetadata } from "#/commands/connection/Ping";
import { Connection } from "#/connection/Connection";
import { TransportError } from "#/errors/TransportError";
import { Commands, defineCommand, Reply, Redis } from "#/index";
import { commandFixture, respond } from "#test/support/commands/Fixture";
import { bytes, controlled, sent } from "#test/support/connection/Controlled";

it.effect("COMMAND-01: Redis Layer composes families over one captured executor", () =>
  Effect.gen(function* () {
    const { connection, fixture } = yield* controlled();
    const live = Redis.layer.pipe(
      Layer.provide(CommandExecutor.layer),
      Layer.provide(Layer.succeed(Connection, connection)),
    );
    yield* Effect.gen(function* () {
      const redis = yield* Redis;
      yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
      expect(yield* respond(fixture, redis.get("missing"), ["GET", "missing"], "$-1\r\n")).toEqual(
        Option.none(),
      );
      expect(
        yield* respond(fixture, redis.incr("count"), ["INCR", "count"], ":9007199254740993\r\n"),
      ).toBe(9007199254740993n);
    }).pipe(Effect.provide(live));
    expect((yield* fixture.observations).acquired).toBe(1);
  }),
);
it.effect("COMMAND-02: UTF-8 argument byte lengths are exact on the production wire path", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const fiber = yield* Effect.forkChild(redis.set("é", new Uint8Array([0, 255])));
    const attempt = yield* fixture.nextWrite;
    expect(attempt.bytes).toEqual(
      new Uint8Array([...bytes("*3\r\n$3\r\nSET\r\n$2\r\né\r\n$2\r\n"), 0, 255, 13, 10]),
    );
    yield* attempt.accept(attempt.bytes.length);
    yield* fixture.receive(bytes("+OK\r\n"));
    yield* Fiber.join(fiber);
  }),
);
it.effect("COMMAND-11: typed server failures are redacted and do not poison later commands", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const failure = yield* respond(
      fixture,
      Effect.flip(redis.get("key")),
      ["GET", "key"],
      "-WRONGTYPE private-value\r\n",
    );
    expect(failure).toMatchObject({ _tag: "ServerError", code: "WRONGTYPE", delivery: "replied" });
    expect(JSON.stringify(failure)).not.toContain("private-value");
    if (failure._tag !== "ServerError") return yield* Effect.die("Expected server error");
    expect(Redacted.value(failure.reply)).toEqual({
      _tag: "SimpleError",
      value: bytes("WRONGTYPE private-value"),
    });
    expect(yield* respond(fixture, redis.get("key"), ["GET", "key"], "$0\r\n\r\n")).toEqual(
      Option.some(""),
    );
  }),
);
it.effect(
  "COMMAND-10: a valid but unexpected reply fails decoding without losing connection ownership",
  () =>
    Effect.gen(function* () {
      const { redis, fixture, connection } = yield* commandFixture();
      expect(
        yield* respond(fixture, Effect.flip(redis.get("key")), ["GET", "key"], ":7\r\n"),
      ).toMatchObject({ _tag: "ReplyError", expected: "blob", delivery: "replied" });
      yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
      expect((yield* connection.snapshot).generation).toBe(1);
    }),
);
it.effect("COMMAND-09: lossless raw calls preserve attributes, maps and server errors", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const contract = { execution: "ordinary", routing: { _tag: "Keyless" } } as const;
    const reply = yield* respond(
      fixture,
      redis.raw(["CUSTOM.MAP"], contract),
      ["CUSTOM.MAP"],
      "|1\r\n+ttl\r\n:1\r\n%1\r\n$1\r\nk\r\n:9007199254740993\r\n",
    );
    expect(reply._tag).toBe("Attribute");
    expect(
      yield* respond(
        fixture,
        redis.raw(["CUSTOM.ERROR"], contract),
        ["CUSTOM.ERROR"],
        "!11\r\nERR private\r\n",
      ),
    ).toEqual({ _tag: "BlobError", value: bytes("ERR private") });
  }),
);
it.effect(
  "COMMAND-12: custom descriptors require real decoding and explicit key/mode contracts",
  () =>
    Effect.gen(function* () {
      const { redis, fixture } = yield* commandFixture();
      const custom = defineCommand({
        metadata: { ...pingMetadata, name: "CUSTOM.COUNT" },
        tokens: ["CUSTOM.COUNT", "binary-key"],
        routing: { _tag: "Keys", keys: [{ index: 1, access: "read" }] },
        decode: Reply.integer,
      });
      expect(
        yield* respond(fixture, redis.execute(custom), ["CUSTOM.COUNT", "binary-key"], ":42\r\n"),
      ).toBe(42n);
      expect(
        yield* respond(
          fixture,
          Effect.flip(redis.execute(custom)),
          ["CUSTOM.COUNT", "binary-key"],
          "+unreviewed\r\n",
        ),
      ).toMatchObject({ _tag: "ReplyError", expected: "integer" });
    }),
);
it.effect(
  "COMMAND-13: session commands, nonordinary modes and explicit nodes fail before writing",
  () =>
    Effect.gen(function* () {
      const { redis, connection } = yield* commandFixture();
      for (const tokens of [["MULTI"], ["CLIENT", "REPLY", "OFF"], ["BLPOP", "key", "0"]] as const)
        expect(
          yield* Effect.flip(
            redis.raw(tokens, { execution: "ordinary", routing: { _tag: "Keyless" } }),
          ),
        ).toMatchObject({ _tag: "AdmissionError", reason: "session-required" });
      expect(
        yield* Effect.flip(
          redis.raw(["CUSTOM.BLOCK"], { execution: "blocking", routing: { _tag: "Keyless" } }),
        ),
      ).toMatchObject({ _tag: "UnsupportedCommandError", reason: "execution-mode" });
      expect(
        yield* Effect.flip(
          redis.raw(["CUSTOM.NODE"], {
            execution: "ordinary",
            routing: { _tag: "Node", node: "node-1" },
          }),
        ),
      ).toMatchObject({ _tag: "UnsupportedCommandError", reason: "explicit-node" });
      expect((yield* connection.snapshot).admitted).toBe(0);
    }),
);
it.effect("COMMAND-14: failures retain delivery evidence without automatic retries", () =>
  Effect.gen(function* () {
    const { redis, fixture, connection } = yield* commandFixture();
    const request = yield* Effect.forkChild(Effect.result(redis.incr("count")));
    yield* sent(fixture, ["INCR", "count"]);
    yield* fixture.failRead(new TransportError({ stage: "read", reason: "closed" }));
    const result = yield* Fiber.join(request);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ConnectionError", delivery: "possibly-written" },
    });
    expect((yield* connection.snapshot).connectionAttempts).toBe(1);
  }),
);
it.effect("COMMAND-12: prepared command executes without asserting an arbitrary result type", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const prepared = yield* Commands.zscoreToken("scores", "member").prepare;
    expect(
      yield* respond(
        fixture,
        redis.executePrepared(prepared),
        ["ZSCORE", "scores", "member"],
        ",0.12345678901234568\r\n",
      ),
    ).toEqual(Option.some("0.12345678901234568"));
  }),
);
