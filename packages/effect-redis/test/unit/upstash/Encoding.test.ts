import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { Commands } from "#/index";
import { decodeUpstashConfig } from "#/upstash/Config";
import { parseJson } from "#/upstash/encoding/Json";
import { encodeRequest } from "#/upstash/encoding/Request";
import { decodeJsonBatch, decodeResp } from "#/upstash/encoding/Response";
import { jsonReplyPolicy } from "#/upstash/encoding/Status";
import { httpConfig } from "#test/support/upstash/Controlled";

it.effect(
  "HTTP configuration rejects secrets in URLs, insecure nonlocal origins and unknown options",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeUpstashConfig(httpConfig);
      expect(config.url).toBe("https://redis.example.test");

      for (const input of [
        { ...httpConfig, url: "https://user:password@redis.example.test" },
        { ...httpConfig, url: "https://redis.example.test/?token=private" },
        { ...httpConfig, url: "http://example.test", allowInsecureLocalhost: true },
        { ...httpConfig, maxNestingDepth: 129 },
        { ...httpConfig, unexpected: true },
      ])
        expect(yield* Effect.flip(decodeUpstashConfig(input))).toMatchObject({
          reason: "configuration",
          delivery: "unsent",
        });

      expect(
        (yield* decodeUpstashConfig({
          ...httpConfig,
          url: "http://127.0.0.1:9000",
          allowInsecureLocalhost: true,
        })).url,
      ).toBe("http://127.0.0.1:9000");
    }),
);

it("provider JSON retains exact numeric lexemes and rejects ambiguous or excessive structures", () => {
  const limits = { maxNestingDepth: 3, maxAggregateEntries: 16 };
  const value = Result.getOrThrow(parseJson('{"result":[9007199254740993,1.250e-3]}', limits));
  expect(value).toEqual(
    new Map([
      [
        "result",
        [
          { _tag: "NumberToken", token: "9007199254740993" },
          { _tag: "NumberToken", token: "1.250e-3" },
        ],
      ],
    ]),
  );

  for (const text of [
    '{"a":1,"a":2}',
    "[01]",
    "[1,]",
    "[1e]",
    "[[[[[1]]]]]",
    '"\\uZZZZ"',
    '{"a":true} trailing',
  ])
    expect(Result.isFailure(parseJson(text, limits))).toBe(true);
  expect(Result.isFailure(parseJson("[1,2,3]", { ...limits, maxAggregateEntries: 2 }))).toBe(true);
});

it.effect(
  "HTTP encoding preserves UTF8/BOM, owns final binary bodies and rejects binary at unrepresentable positions",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeUpstashConfig(httpConfig);
      const text = yield* Commands.set("key", new TextEncoder().encode("\ufeffhello")).prepare;
      const encoded = yield* encodeRequest([text], "ordinary", config);
      expect(JSON.parse(new TextDecoder().decode(encoded.body))).toEqual([
        "SET",
        "key",
        "\ufeffhello",
      ]);

      const bytes = new Uint8Array([0, 255, 128]);
      const prepared = yield* Commands.set("a/b", bytes).prepare;
      const binary = yield* encodeRequest([prepared], "ordinary", config);
      bytes.fill(7);
      expect(binary.path).toBe("/SET/a%2Fb");
      expect(binary.body).toEqual(new Uint8Array([0, 255, 128]));

      const invalid = yield* Commands.set(new Uint8Array([255]), "value").prepare;
      expect(yield* Effect.flip(encodeRequest([invalid], "ordinary", config))).toMatchObject({
        reason: "encoding",
        delivery: "unsent",
      });
      const binaryBatch = yield* Commands.set("key", new Uint8Array([255])).prepare;
      expect(yield* Effect.flip(encodeRequest([binaryBatch], "transaction", config))).toMatchObject(
        {
          reason: "encoding",
        },
      );

      for (const key of [".", ".."]) {
        const normalized = yield* Commands.set(key, new Uint8Array([255])).prepare;
        expect(yield* Effect.flip(encodeRequest([normalized], "ordinary", config))).toMatchObject({
          reason: "encoding",
          delivery: "unsent",
        });
      }
    }),
);

it.effect(
  "RESP and JSON response decoding retain cardinality, integers, binary and command-dependent OK semantics",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeUpstashConfig(httpConfig);
      const commands = yield* Effect.forEach(
        [Commands.set("key", "OK"), Commands.getBytes("key"), Commands.incr("count")],
        (command) => command.prepare,
      );
      const body = Result.getOrThrow(
        parseJson('[{"result":"OK"},{"result":"OK"},{"result":9007199254740993}]', config),
      );
      const replies = yield* decodeJsonBatch(body, commands.map(jsonReplyPolicy));
      expect(replies).toEqual([
        { _tag: "SimpleString", value: new TextEncoder().encode("OK") },
        { _tag: "BlobString", value: new TextEncoder().encode("OK") },
        { _tag: "Integer", value: 9007199254740993n },
      ]);

      const binary = yield* decodeResp(new Uint8Array([36, 50, 13, 10, 0, 255, 13, 10]), 1, config);
      expect(binary).toEqual([{ _tag: "BlobString", value: new Uint8Array([0, 255]) }]);
      expect(
        yield* Effect.flip(decodeResp(new TextEncoder().encode(":1\r\n:2\r\n"), 1, config)),
      ).toMatchObject({ reason: "malformed" });
      expect(
        yield* Effect.flip(
          decodeJsonBatch(Result.getOrThrow(parseJson('[{"result":"!bad"}]', config)), [
            jsonReplyPolicy(yield* Commands.getBytes("key").prepare),
          ]),
        ),
      ).toMatchObject({ reason: "malformed" });
    }),
);
