import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { Commands } from "#/index";
import { decodeUpstashConfig } from "#/upstash/Config";
import { parseJson } from "#/upstash/encoding/Json";
import { decodeJsonBatch, decodeResp } from "#/upstash/encoding/Response";
import { jsonReplyPolicy } from "#/upstash/encoding/Status";
import { httpConfig } from "#test/support/upstash/Controlled";

it.effect.each([
  ['[{"result":"AA==="}]', "malformed"],
  ['[{"result":"AB=="}]', "malformed"],
  ['[{"result":{"data":"literal-key"}}]', "encoding"],
  ['[{"result":1,"error":"ERR"}]', "malformed"],
  ['[{"unknown":1}]', "malformed"],
  [`[{"result":${"1".repeat(1025)}}]`, "limit"],
] as const)("JSON response boundary rejects %s without lossy coercion", ([text, reason]) =>
  Effect.gen(function* () {
    const config = yield* decodeUpstashConfig(httpConfig);
    const policy = jsonReplyPolicy(yield* Commands.getBytes("key").prepare);
    const value = Result.getOrThrow(parseJson(text, config));

    expect(yield* Effect.flip(decodeJsonBatch(value, [policy]))).toMatchObject({
      _tag: "UpstashError",
      reason,
    });
  }),
);

it.effect.each(["$2\r\na", ":1\r\n:2\r\n", "+OK\n", "$-2\r\n"])(
  "RESP response boundary rejects incomplete/extra frames: %s",
  (wire) =>
    Effect.gen(function* () {
      const config = yield* decodeUpstashConfig(httpConfig);
      expect(
        yield* Effect.flip(decodeResp(new TextEncoder().encode(wire), 1, config)),
      ).toMatchObject({ reason: "malformed" });
    }),
);
