import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands } from "#/upstash";
import { array, blob, bytes, integer, missing } from "#test/support/commands/CoreCase";
import { extensionCases } from "#test/support/upstash/CommandCases";

extensionCases("UPSTASH-VECTOR", [
  {
    label: "create",
    command: Commands.vectorCreate("idx", { dimension: 2, metric: "COSINE", existsOk: true }),
    tokens: ["VECTOR.CREATE", "idx", "DIM", "2", "METRIC", "COSINE", "EXISTSOK"],
    reply: integer(1n),
    expected: true,
  },
  {
    label: "add",
    command: Commands.vectorAdd("idx", "one", { _tag: "Values", coordinates: [1, 0] }),
    tokens: ["VECTOR.ADD", "idx", "one", "VALUES", "2", "1", "0"],
    reply: integer(0n),
    expected: false,
  },
  {
    label: "get",
    command: Commands.vectorGet("idx", "one"),
    tokens: ["VECTOR.GET", "idx", "one"],
    reply: array(blob("1"), blob("0")),
    expected: Option.some([1, 0]),
  },
  {
    label: "query",
    command: Commands.vectorQuery(
      "idx",
      { _tag: "Values", coordinates: [1, 0] },
      { topK: 2, profile: "PRECISE" },
    ),
    tokens: ["VECTOR.QUERY", "idx", "TOPK", "2", "VALUES", "2", "1", "0", "PROFILE", "PRECISE"],
    reply: array(array(blob("one"), blob("0.875"))),
    expected: [{ id: bytes("one"), score: 0.875 }],
  },
  {
    label: "del",
    command: Commands.vectorDel("idx", "one"),
    tokens: ["VECTOR.DEL", "idx", "one"],
    reply: integer(1n),
    expected: true,
  },
  {
    label: "count",
    command: Commands.vectorCount("idx"),
    tokens: ["VECTOR.COUNT", "idx"],
    reply: integer(9007199254740993n),
    expected: 9007199254740993n,
  },
  {
    label: "info",
    command: Commands.vectorInfo("idx"),
    tokens: ["VECTOR.INFO", "idx"],
    reply: array(blob("dimension"), integer(2n), blob("metric"), blob("COSINE")),
    expected: Option.some({ dimension: 2, metric: "COSINE" }),
  },
  {
    label: "drop",
    command: Commands.vectorDrop("idx"),
    tokens: ["VECTOR.DROP", "idx"],
    reply: integer(0n),
    expected: false,
  },
]);

it.effect(
  "Vector FP32 uses explicit little endian/base64 and rejects nonfinite or malformed embeddings",
  () =>
    Effect.gen(function* () {
      const encoded = yield* Commands.base64Fp32([1, -2]);
      expect(encoded).toEqual({ _tag: "Base64FP32", base64: "AACAPwAAAMA=" });
      expect((yield* Commands.vectorAdd("idx", "one", encoded).prepare).tokens).toEqual([
        "VECTOR.ADD",
        "idx",
        "one",
        "BASE64-FP32",
        "AACAPwAAAMA=",
      ]);

      for (const input of [
        { _tag: "FP32" as const, bytes: new Uint8Array(3) },
        { _tag: "FP32" as const, bytes: new Uint8Array([0, 0, 128, 127]) },
        { _tag: "Base64FP32" as const, base64: "!bad" },
        { _tag: "Values" as const, coordinates: [Number.MAX_VALUE] as [number] },
      ])
        expect(yield* Effect.flip(Commands.vectorAdd("idx", "one", input).prepare)).toMatchObject({
          _tag: "CommandInputError",
        });
    }),
);

it.effect(
  "Vector decoders accept RESP3 metadata/doubles, preserve absence and reject invalid dimensions or scores",
  () =>
    Effect.gen(function* () {
      const info = yield* Commands.vectorInfo("idx").prepare;
      expect(
        yield* decodeReply(info, {
          _tag: "Map",
          entries: [
            [blob("dimension"), integer(2n)],
            [blob("metric"), blob("DOT")],
          ],
        }),
      ).toEqual(Option.some({ dimension: 2, metric: "DOT" }));
      expect(yield* decodeReply(info, missing)).toEqual(Option.none());
      expect(
        yield* Effect.flip(
          decodeReply(info, array(blob("dimension"), integer(0n), blob("metric"), blob("DOT"))),
        ),
      ).toMatchObject({ _tag: "ReplyError" });

      const options = { topK: 1 };
      const query = yield* Commands.vectorQuery(
        "idx",
        { _tag: "Values", coordinates: [1] },
        options,
      ).prepare;
      options.topK = 100;
      expect(
        yield* decodeReply(
          query,
          array(array({ _tag: "SimpleString", value: new Uint8Array([255, 0]) }, blob("1"))),
        ),
      ).toEqual([{ id: new Uint8Array([255, 0]), score: 1 }]);
      expect(
        yield* Effect.flip(decodeReply(query, array(array(blob("one"), blob("1.5"))))),
      ).toMatchObject({ _tag: "ReplyError" });
      expect(
        yield* Effect.flip(
          decodeReply(query, array(array(blob("one"), blob("1")), array(blob("two"), blob("0")))),
        ),
      ).toMatchObject({ _tag: "ReplyError" });
    }),
);
