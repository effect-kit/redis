import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Commands, PayloadCodec, RedisKey } from "../../src/index.js";
import { commandFixture, respond } from "../support/commands/Fixture.js";
import { DecodeLabel, EncodeLabel, labelSchema } from "../support/commands/SchemaServices.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const User = Schema.Struct({
  name: Schema.String,
  age: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
it.effect("COMMAND-15: JSON keys encode explicitly and validate stored payloads", () =>
  Effect.gen(function* () {
    const { redis, fixture } = yield* commandFixture();
    const key = RedisKey.json("user:1", User);
    yield* respond(
      fixture,
      redis.setKey(key, { name: "Ada", age: 37 }),
      ["SET", "user:1", bytes('{"name":"Ada","age":37}')],
      "+OK\r\n",
    );
    const payload = '{"name":"Ada","age":37}';
    expect(
      yield* respond(
        fixture,
        redis.getKey(key),
        ["GET", "user:1"],
        `$${bytes(payload).length}\r\n${payload}\r\n`,
      ),
    ).toEqual(Option.some({ name: "Ada", age: 37 }));
    expect(yield* respond(fixture, redis.getKey(key), ["GET", "user:1"], "$-1\r\n")).toEqual(
      Option.none(),
    );
  }),
);
it.effect("COMMAND-16: invalid application values fail encoding before a socket write", () =>
  Effect.gen(function* () {
    const { redis, connection } = yield* commandFixture();
    const key = RedisKey.json("user:1", User);
    const failure = yield* Effect.flip(redis.setKey(key, { name: "private-name", age: -1 }));
    expect(failure).toMatchObject({ _tag: "PayloadError", stage: "encode" });
    expect(JSON.stringify(failure)).not.toContain("private-name");
    expect((yield* connection.snapshot).admitted).toBe(0);
  }),
);
it.effect.each(['{"name":"private-name","age":-1}', "private-invalid-json", "null"])(
  "COMMAND-17: stored payload failures are redacted and leave the connection usable %#",
  (payload) =>
    Effect.gen(function* () {
      const { redis, fixture, connection } = yield* commandFixture();
      const key = RedisKey.json("user:1", User);
      const failure = yield* respond(
        fixture,
        Effect.flip(redis.getKey(key)),
        ["GET", "user:1"],
        `$${bytes(payload).length}\r\n${payload}\r\n`,
      );
      expect(failure).toMatchObject({ _tag: "PayloadError", stage: "decode" });
      expect(JSON.stringify(failure)).not.toContain("private-");
      yield* respond(fixture, redis.ping(), ["PING"], "+PONG\r\n");
      expect((yield* connection.snapshot).unknownOutcomes).toBe(0);
    }),
);
it.effect("COMMAND-18: text codecs preserve BOM and reject malformed bytes", () =>
  Effect.gen(function* () {
    const codec = PayloadCodec.text;
    expect(yield* codec.decode(yield* codec.encode("\ufeffhello"))).toBe("\ufeffhello");
    expect(yield* Effect.flip(codec.decode(new Uint8Array([255])))).toMatchObject({
      _tag: "PayloadError",
      stage: "decode",
    });
    const number = PayloadCodec.schemaText(Schema.NumberFromString);
    expect(yield* number.encode(42)).toEqual(bytes("42"));
    expect(yield* number.decode(bytes("42"))).toBe(42);
  }),
);
it.effect(
  "COMMAND-19: schema codecs preserve independent decoding and encoding service requirements",
  () =>
    Effect.gen(function* () {
      for (const codec of [PayloadCodec.schemaText(labelSchema), PayloadCodec.json(labelSchema)]) {
        const encoded = yield* codec
          .encode("value")
          .pipe(Effect.provideService(EncodeLabel, { prefix: "encoded:" }));
        const decoded = yield* codec
          .decode(encoded)
          .pipe(Effect.provideService(DecodeLabel, { prefix: "decoded:" }));
        expect(decoded).toBe("decoded:encoded:value");
      }
      const { redis, fixture } = yield* commandFixture();
      const key = RedisKey.schemaText("label", labelSchema);
      yield* respond(
        fixture,
        redis.setKey(key, "value").pipe(Effect.provideService(EncodeLabel, { prefix: "encoded:" })),
        ["SET", "label", bytes("encoded:value")],
        "+OK\r\n",
      );
      expect(
        yield* respond(
          fixture,
          redis.getKey(key).pipe(Effect.provideService(DecodeLabel, { prefix: "decoded:" })),
          ["GET", "label"],
          "$3\r\nold\r\n",
        ),
      ).toEqual(Option.some("decoded:old"));
    }),
);
it.effect(
  "COMMAND-20: typed-key writes reject GET at runtime and preserve conditional results",
  () =>
    Effect.gen(function* () {
      const { redis, fixture, connection } = yield* commandFixture();
      const key = RedisKey.text("name");
      expect(
        yield* Effect.flip(redis.execute(Commands.setKey(key, "value", { get: true } as never))),
      ).toMatchObject({ _tag: "CommandInputError", reason: "options" });
      expect((yield* connection.snapshot).admitted).toBe(0);
      expect(
        yield* respond(
          fixture,
          redis.setKey(key, "value", { condition: "NX" }),
          ["SET", "name", bytes("value"), "NX"],
          "$-1\r\n",
        ),
      ).toBe(false);
    }),
);
