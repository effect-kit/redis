import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";

import { keySlot } from "#/cluster/Slot";
import { integer } from "#/command/reply/Scalars";
import { ServerError } from "#/errors/ServerError";
import type { RedisScript } from "#/scripting/RedisScript";
import { clusterControlled, slotReply } from "#test/support/cluster/Controlled";
import { bytes, sent } from "#test/support/connection/Controlled";

const script: RedisScript<bigint> = {
  sha1: "hash",
  source: Redacted.make(bytes("return 1")),
  readOnly: false,
  decode: integer,
};

it.effect("re-arms ASKING after NOSCRIPT and loads on the importing physical lease", () =>
  Effect.gen(function* () {
    const { client, a, b } = yield* clusterControlled();
    const scripts = yield* client.scripts({ key: "foo" });
    const run = yield* Effect.forkChild(scripts.execute(script, { keys: ["foo"] }));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["EVALSHA", "hash", "1", "foo"], `-ASK ${keySlot("foo")} b:6379\r\n`);
    yield* sent(b, ["READWRITE"], "+OK\r\n");
    yield* sent(b, ["ASKING"], "+OK\r\n");
    yield* sent(
      b,
      ["EVALSHA", "hash", "1", "foo"],
      "-NOSCRIPT No matching script. Please use EVAL.\r\n",
    );
    yield* sent(b, ["SCRIPT", "LOAD", bytes("return 1")], "$4\r\nhash\r\n");
    yield* sent(b, ["ASKING"], "+OK\r\n");
    yield* sent(b, ["EVALSHA", "hash", "1", "foo"], ":1\r\n");

    expect(yield* Fiber.join(run)).toBe(1n);
  }),
);

it.effect("does not confuse successful loading on different nodes", () =>
  Effect.gen(function* () {
    const { client, seed, a, b } = yield* clusterControlled();
    const scripts = yield* client.scripts({ key: "foo" }, { loadScope: "server" });
    const first = yield* Effect.forkChild(scripts.execute(script, { keys: ["foo"] }));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["EVALSHA", "hash", "1", "foo"], "-NOSCRIPT No matching script.\r\n");
    yield* sent(a, ["SCRIPT", "LOAD", bytes("return 1")], "$4\r\nhash\r\n");
    yield* sent(a, ["EVALSHA", "hash", "1", "foo"], ":1\r\n");
    expect(yield* Fiber.join(first)).toBe(1n);

    const second = yield* Effect.forkChild(scripts.execute(script, { keys: ["foo"] }));
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["EVALSHA", "hash", "1", "foo"], `-MOVED ${keySlot("foo")} b:6379\r\n`);
    yield* sent(seed, ["CLUSTER", "SLOTS"], slotReply("b", "node-b"));
    yield* sent(b, ["READWRITE"], "+OK\r\n");
    yield* sent(b, ["EVALSHA", "hash", "1", "foo"], "-NOSCRIPT No matching script.\r\n");
    yield* sent(b, ["SCRIPT", "LOAD", bytes("return 1")], "$4\r\nhash\r\n");
    yield* sent(b, ["EVALSHA", "hash", "1", "foo"], ":2\r\n");
    expect(yield* Fiber.join(second)).toBe(2n);
  }),
);

it.effect("application decoders cannot authorize a Cluster script replay", () =>
  Effect.gen(function* () {
    const { client, a, b } = yield* clusterControlled();
    const scripts = yield* client.scripts({ key: "foo" });
    const decoder = new ServerError({
      delivery: "replied",
      code: "MOVED",
      reply: Redacted.make({ _tag: "SimpleError", value: bytes(`MOVED ${keySlot("foo")} b:6379`) }),
    });
    const run = yield* Effect.forkChild(
      Effect.result(
        scripts.execute({ ...script, decode: () => Effect.fail(decoder) }, { keys: ["foo"] }),
      ),
    );
    yield* sent(a, ["READWRITE"], "+OK\r\n");
    yield* sent(a, ["EVALSHA", "hash", "1", "foo"], ":1\r\n");

    expect(yield* Fiber.join(run)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ServerError", code: "MOVED" },
    });
    expect((yield* b.observations).acquired).toBe(0);
  }),
);
