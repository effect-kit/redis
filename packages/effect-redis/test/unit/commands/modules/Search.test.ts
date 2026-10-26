import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { decodeReply } from "#/command/Decode";
import { Commands } from "#/index";
import type { RespValue } from "#/index";

const blob = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});
const simple = (value: string): RespValue => ({
  _tag: "SimpleString",
  value: new TextEncoder().encode(value),
});
const int = (value: bigint): RespValue => ({ _tag: "Integer", value });
const array = (...values: RespValue[]): RespValue => ({ _tag: "Array", values });

it.effect("search reply width and projection counts bind to immutable preparation flags", () =>
  Effect.gen(function* () {
    const options = {
      withScores: true,
      withPayloads: true,
      noContent: true,
      returnFields: [{ field: "title", as: "name" }],
    };
    const command = yield* Commands.ftSearch("idx", "hello", options).prepare;
    options.withScores = false;
    options.withPayloads = false;
    options.noContent = false;
    expect(command.tokens).toContain("WITHSCORES");
    expect(command.tokens.slice(-5)).toEqual(["RETURN", "3", "title", "AS", "name"]);
    const receipt = yield* decodeReply(
      command,
      array(int(9007199254740993n), blob("id"), blob("0.5"), { _tag: "Null", kind: "bulk" }),
    );
    expect(receipt.total).toBe(9007199254740993n);
    expect(receipt.documents[0]?.score).toEqual(
      Option.some({ value: 0.5, explanation: Option.none() }),
    );
    expect(receipt.documents[0]?.fields).toEqual(Option.none());
    expect((yield* Effect.flip(decodeReply(command, array(int(1n), blob("id")))))._tag).toBe(
      "ReplyError",
    );
  }),
);

it.effect("Search native replies preserve binary fields and unknown metadata", () =>
  Effect.gen(function* () {
    const command = yield* Commands.ftSearch("idx", "hello").prepare;
    const fields: RespValue = { _tag: "Map", entries: [[blob("binary"), blob("value")]] };
    const reply: RespValue = {
      _tag: "Map",
      entries: [
        [simple("total_results"), int(1n)],
        [
          simple("results"),
          array({
            _tag: "Map",
            entries: [
              [simple("id"), blob("id")],
              [simple("extra_attributes"), fields],
              [simple("future"), int(2n)],
            ],
          }),
        ],
        [simple("warning"), array(blob("partial"))],
      ],
    };
    const result = yield* decodeReply(command, reply);
    expect(result.documents[0]?.fields).toEqual(
      Option.some([[new TextEncoder().encode("binary"), blob("value")]]),
    );
    expect(result.documents[0]?.metadata).toEqual([["future", int(2n)]]);
    expect(result.metadata).toEqual([["warning", array(blob("partial"))]]);
  }),
);

it.effect("Search vector schema and PARAMS count tokens rather than logical pairs", () =>
  Effect.gen(function* () {
    const vector = new Uint8Array([0, 1, 2, 3]);
    const command = yield* Commands.ftCreate("idx", [
      {
        field: "vec",
        type: "VECTOR",
        algorithm: "HNSW",
        attributes: {
          dataType: "FLOAT32",
          dimensions: 2,
          distanceMetric: "COSINE",
          connections: 8,
        },
      },
    ]).prepare;
    expect(command.tokens.slice(-10)).toEqual([
      "HNSW",
      "8",
      "TYPE",
      "FLOAT32",
      "DIM",
      "2",
      "DISTANCE_METRIC",
      "COSINE",
      "M",
      "8",
    ]);
    const query = yield* Commands.ftSearch("idx", "query", {
      params: [["vec", vector]],
      dialect: 2,
    }).prepare;
    expect(query.tokens).toEqual([
      "FT.SEARCH",
      "idx",
      "query",
      "PARAMS",
      "2",
      "vec",
      vector,
      "DIALECT",
      "2",
    ]);
    expect(command.routing).toEqual({ _tag: "Keyless" });
  }),
);

it.effect(
  "aggregate steps preserve order and native module counts without manufacturing totals",
  () =>
    Effect.gen(function* () {
      const command = yield* Commands.ftAggregate("idx", "hello", {
        steps: [
          { _tag: "Load", fields: [{ field: "@title", as: "name" }] },
          { _tag: "Filter", expression: "exists(@name)" },
          { _tag: "Limit", offset: 0, count: 2 },
        ],
      }).prepare;
      expect(command.tokens).toEqual([
        "FT.AGGREGATE",
        "idx",
        "hello",
        "LOAD",
        "3",
        "@title",
        "AS",
        "name",
        "FILTER",
        "exists(@name)",
        "LIMIT",
        "0",
        "2",
      ]);
      const result = yield* decodeReply(
        command,
        array(int(1n), array(simple("name"), blob("one")), array(simple("name"), blob("two"))),
      );
      expect(result.total).toBe(1n);
      expect(result.rows.length).toBe(2);
    }),
);

it.effect("cursor decoding rejects incomplete receipts and keeps exact IDs", () =>
  Effect.gen(function* () {
    const command = yield* Commands.ftCursorRead("idx", 9007199254740993n).prepare;
    expect(
      (yield* decodeReply(command, array(array(int(0n)), int(9007199254740993n)))).cursor,
    ).toBe(9007199254740993n);
    expect((yield* Effect.flip(decodeReply(command, array(array(int(0n))))))._tag).toBe(
      "ReplyError",
    );
    expect((yield* Effect.flip(Commands.ftCursorRead("idx", 0).prepare))._tag).toBe(
      "CommandInputError",
    );
  }),
);

it.effect("suggestions and spelling validate flattened payload/score groups", () =>
  Effect.gen(function* () {
    const suggestions = yield* Commands.ftSuggetWithScoresAndPayloads("s", "he").prepare;
    expect(
      yield* decodeReply(
        suggestions,
        array(blob("hello"), blob("0.5"), { _tag: "Null", kind: "bulk" }),
      ),
    ).toEqual([{ term: new TextEncoder().encode("hello"), score: 0.5, payload: Option.none() }]);
    expect((yield* Effect.flip(decodeReply(suggestions, array(blob("orphan")))))._tag).toBe(
      "ReplyError",
    );
    const spelling = yield* Commands.ftSpellcheck("idx", "helo").prepare;
    expect(
      (yield* decodeReply(
        spelling,
        array(array(simple("TERM"), blob("helo"), array(array(blob("1"), blob("hello"))))),
      ))[0]?.suggestions[0]?.score,
    ).toBe(1);
  }),
);

it.effect(
  "configuration HELP normalizes native maps and legacy flat descriptions under redaction",
  () =>
    Effect.gen(function* () {
      const command = yield* Commands.ftConfigHelp("TIMEOUT").prepare;
      const reply = array(
        array(
          simple("TIMEOUT"),
          simple("Description"),
          simple("deadline"),
          simple("Value"),
          blob("500"),
        ),
      );
      expect(Redacted.value(yield* decodeReply(command, reply))).toEqual([
        { name: "TIMEOUT", description: "deadline", value: Option.some("500") },
      ]);
    }),
);

it.effect("hybrid counts nested clauses and rejects incompatible query flags", () =>
  Effect.gen(function* () {
    const command = yield* Commands.ftHybrid(
      "idx",
      "hello",
      {
        field: "@v",
        vector: "$vec",
        neighbors: { _tag: "KNN", count: 10, efRuntime: 20 },
        filter: { expression: "@tag:{a}", policy: "BATCHES", batchSize: 10 },
      },
      { combine: { _tag: "Linear", weights: [0.5, 0.5] }, params: [["vec", new Uint8Array(8)]] },
    ).prepare;
    expect(command.tokens.slice(7, 18)).toEqual([
      "KNN",
      "4",
      "K",
      "10",
      "EF_RUNTIME",
      "20",
      "FILTER",
      "5",
      "@tag:{a}",
      "POLICY",
      "BATCHES",
    ]);
    expect(
      (yield* Effect.flip(Commands.ftSearch("idx", "hello", { explainScore: true }).prepare))._tag,
    ).toBe("CommandInputError");
    expect(
      (yield* Effect.flip(
        Commands.ftHybrid(
          "idx",
          "hello",
          { field: "@v", vector: "$vec" },
          { sortBy: [{ field: "x" }], noSort: true },
        ).prepare,
      ))._tag,
    ).toBe("CommandInputError");
  }),
);
