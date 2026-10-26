import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import type { Command } from "#/command/Command";
import { decodeReply } from "#/command/Decode";
import { Commands } from "#/upstash";
import { array, blob, bytes, integer, missing } from "#test/support/commands/CoreCase";
import { extensionCases } from "#test/support/upstash/CommandCases";

extensionCases("UPSTASH-SEARCH", [
  {
    label: "create",
    command: Commands.searchCreate("idx", {
      on: { type: "JSON", prefixes: ["doc:"] },
      fields: [
        { name: "name", type: "TEXT", noStem: true },
        { name: "price", type: "F64", fast: true, from: "cost" },
      ],
      existsOk: true,
    }),
    tokens: [
      "SEARCH.CREATE",
      "idx",
      "ON",
      "JSON",
      "PREFIX",
      "1",
      "doc:",
      "EXISTSOK",
      "SCHEMA",
      "name",
      "TEXT",
      "NOSTEM",
      "price",
      "F64",
      "FAST",
      "FROM",
      "cost",
    ],
    reply: integer(1n),
    expected: true,
  },
  {
    label: "drop",
    command: Commands.searchDrop("idx"),
    tokens: ["SEARCH.DROP", "idx"],
    reply: integer(0n),
    expected: false,
  },
  {
    label: "describe",
    command: Commands.searchDescribe("idx"),
    tokens: ["SEARCH.DESCRIBE", "idx"],
    reply: array(
      blob("name"),
      blob("idx"),
      blob("type"),
      blob("JSON"),
      blob("prefixes"),
      array(blob("doc:")),
      blob("language"),
      blob("english"),
      blob("indexSize"),
      integer(9007199254740993n),
      blob("pendingUpdates"),
      integer(0n),
      blob("schema"),
      array(array(blob("name"), blob("TEXT"))),
    ),
    expected: Option.some({
      name: "idx",
      type: "JSON",
      prefixes: ["doc:"],
      language: "english",
      indexSize: 9007199254740993n,
      pendingUpdates: 0n,
      schema: [array(blob("name"), blob("TEXT"))],
    }),
  },
  {
    label: "wait",
    command: Commands.searchWaitIndexing("idx"),
    tokens: ["SEARCH.WAITINDEXING", "idx"],
    reply: integer(1n),
    expected: true,
  },
  {
    label: "list",
    command: Commands.searchListIndexes({ match: "i*", limit: 3, offset: 1 }),
    tokens: ["SEARCH.LISTINDEXES", "MATCH", "i*", "LIMIT", "3", "OFFSET", "1"],
    reply: array(array(blob("name"), blob("idx"), blob("type"), blob("JSON"))),
    expected: [{ name: "idx", type: "JSON" }],
  },
  {
    label: "query",
    command: Commands.searchQuery(
      "idx",
      { name: "hello" },
      { select: ["name"], highlight: { fields: ["name"], tags: ["<b>", "</b>"] } },
    ),
    tokens: [
      "SEARCH.QUERY",
      "idx",
      '{"name":"hello"}',
      "SELECT",
      "1",
      "name",
      "HIGHLIGHT",
      "FIELDS",
      "1",
      "name",
      "TAGS",
      "<b>",
      "</b>",
    ],
    reply: array(array(blob("doc:1"), blob("0.5"), array(array(blob("name"), blob("hello"))))),
    expected: Option.some([
      { key: bytes("doc:1"), score: 0.5, content: [[bytes("name"), blob("hello")]] },
    ]),
  },
  {
    label: "count sentinel",
    command: Commands.searchCount("idx", {}),
    tokens: ["SEARCH.COUNT", "idx", "{}"],
    reply: integer(-1n),
    expected: -1n,
  },
  {
    label: "aggregate cursor",
    command: Commands.searchAggregate("idx", {}, { by: { $composite: { sources: [] } } }),
    tokens: ["SEARCH.AGGREGATE", "idx", "{}", '{"by":{"$composite":{"sources":[]}}}'],
    reply: array(blob("by"), array(blob("afterKey"), array(blob("field"), blob("f64:20")))),
    expected: Option.some([["by", array(blob("afterKey"), array(blob("field"), blob("f64:20")))]]),
  },
  {
    label: "alias add",
    command: Commands.searchAliasAdd("alias", "idx"),
    tokens: ["SEARCH.ALIASADD", "alias", "idx"],
    reply: integer(2n),
    expected: 2,
  },
  {
    label: "alias del",
    command: Commands.searchAliasDel("alias"),
    tokens: ["SEARCH.ALIASDEL", "alias"],
    reply: integer(1n),
    expected: true,
  },
  {
    label: "alias pairs",
    command: Commands.searchListAliases(),
    tokens: ["SEARCH.LISTALIASES"],
    reply: array(array(blob("alias"), blob("idx"))),
    expected: [["alias", "idx"]],
  },
]);

it.effect(
  "Search NOCONTENT binds a distinct shape and rejects malformed content/score/index types",
  () =>
    Effect.gen(function* () {
      const keys = yield* Commands.searchQueryKeys("idx", '{"id":9007199254740993}', {
        limit: 2,
        orderBy: { field: "price", direction: "ASC" },
      }).prepare;
      expect(keys.tokens).toEqual([
        "SEARCH.QUERY",
        "idx",
        '{"id":9007199254740993}',
        "LIMIT",
        "2",
        "ORDERBY",
        "price",
        "ASC",
        "NOCONTENT",
      ]);
      expect(
        yield* decodeReply(keys, array(array(blob("doc:1"), { _tag: "Double", value: "1.25" }))),
      ).toEqual(Option.some([{ key: bytes("doc:1"), score: 1.25 }]));
      expect(yield* decodeReply(keys, missing)).toEqual(Option.none());
      const simpleKey = { _tag: "SimpleString" as const, value: bytes("doc:1") };
      expect(yield* decodeReply(keys, array(array(simpleKey, blob("1"))))).toEqual(
        Option.some([{ key: bytes("doc:1"), score: 1 }]),
      );
      const query = yield* Commands.searchQuery("idx", {}).prepare;
      expect(
        yield* decodeReply(
          query,
          array(
            array(
              simpleKey,
              blob("1"),
              array(
                array(
                  { _tag: "SimpleString", value: bytes("$") },
                  { _tag: "SimpleString", value: bytes("{}") },
                ),
              ),
            ),
          ),
        ),
      ).toEqual(
        Option.some([
          {
            key: bytes("doc:1"),
            score: 1,
            content: [[bytes("$"), { _tag: "SimpleString", value: bytes("{}") }]],
          },
        ]),
      );

      for (const reply of [
        array(array(blob("key"))),
        array(array(blob("key"), blob("nan"))),
        array(array(blob("key"), blob("1"), array())),
      ])
        expect(yield* Effect.flip(decodeReply(keys, reply))).toMatchObject({ _tag: "ReplyError" });
    }),
);

it.effect(
  "Search validation rejects incompatible clauses, overlapping prefixes and unsafe/cyclic JSON",
  () =>
    Effect.gen(function* () {
      const invalid: ReadonlyArray<Command<unknown, unknown>> = [
        Commands.searchCreate("idx", {
          on: { type: "HASH", prefixes: ["doc:", "doc:one"] },
          fields: [{ name: "name", type: "TEXT" }],
        }),
        Commands.searchQuery(
          "idx",
          {},
          { orderBy: { field: "price" }, scoreFunctions: { fields: [{ field: "price" }] } },
        ),
        Commands.searchQuery("idx", {}, { limit: 1001 }),
        Commands.searchCount("idx", '{"duplicate":1,"duplicate":2}'),
        Commands.searchCount("idx", { id: 9007199254740992 }),
      ];
      for (const command of invalid)
        expect(yield* Effect.flip(command.prepare)).toMatchObject({
          _tag: "CommandInputError",
          delivery: "unsent",
        });

      const cyclic: { child?: unknown } = {};
      cyclic.child = cyclic;
      expect(
        yield* Effect.flip(Commands.searchCount("idx", cyclic as never).prepare),
      ).toMatchObject({ _tag: "CommandInputError" });
    }),
);
