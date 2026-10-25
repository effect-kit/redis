import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Commands, Reply } from "#/index";
import { array, blob, bytes, commandCases, integer, ok } from "#test/support/commands/CoreCase";

commandCases("SCRIPT", [
  {
    label: "eval",
    command: Commands.evalScript("return ARGV[1]", { keys: ["k"], args: ["v"] }, Reply.blob),
    tokens: ["EVAL", "return ARGV[1]", "1", "k", "v"],
    keys: [3],
    reply: blob("v"),
    expected: bytes("v"),
  },
  {
    label: "sha",
    command: Commands.evalSha("sha", { keys: [] }, Reply.integer),
    tokens: ["EVALSHA", "sha", "0"],
    keys: [],
    reply: integer(9007199254740993n),
    expected: 9007199254740993n,
  },
  {
    label: "read only",
    command: Commands.evalReadOnly("return 1", { keys: ["a", "b"] }, Reply.integer),
    tokens: ["EVAL_RO", "return 1", "2", "a", "b"],
    keys: [3, 4],
    reply: integer(1n),
    expected: 1n,
  },
  {
    label: "sha read only",
    command: Commands.evalShaReadOnly("sha", { keys: [] }, Reply.integer),
    tokens: ["EVALSHA_RO", "sha", "0"],
    keys: [],
    reply: integer(1n),
    expected: 1n,
  },
  {
    label: "function",
    command: Commands.fcall("f", { keys: ["k"] }, Reply.integer),
    tokens: ["FCALL", "f", "1", "k"],
    keys: [3],
    reply: integer(1n),
    expected: 1n,
  },
  {
    label: "function read only",
    command: Commands.fcallReadOnly("f", { keys: [] }, Reply.integer),
    tokens: ["FCALL_RO", "f", "0"],
    keys: [],
    reply: integer(1n),
    expected: 1n,
  },
  {
    label: "load",
    command: Commands.scriptLoad("body"),
    tokens: ["SCRIPT", "LOAD", "body"],
    keys: [],
    reply: blob("digest"),
    expected: "digest",
  },
  {
    label: "exists",
    command: Commands.scriptExists(["a", "b"]),
    tokens: ["SCRIPT", "EXISTS", "a", "b"],
    keys: [],
    reply: array(integer(1n), integer(0n)),
    expected: [true, false],
  },
  {
    label: "flush",
    command: Commands.scriptFlush("ASYNC"),
    tokens: ["SCRIPT", "FLUSH", "ASYNC"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "kill",
    command: Commands.scriptKill(),
    tokens: ["SCRIPT", "KILL"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "help",
    command: Commands.scriptHelp(),
    tokens: ["SCRIPT", "HELP"],
    keys: [],
    reply: array(blob("h")),
    expected: ["h"],
  },
  {
    label: "show",
    command: Commands.scriptShow("sha"),
    tokens: ["SCRIPT", "SHOW", "sha"],
    keys: [],
    reply: blob("body"),
    expected: bytes("body"),
  },
  {
    label: "function load",
    command: Commands.functionLoad("code", true),
    tokens: ["FUNCTION", "LOAD", "REPLACE", "code"],
    keys: [],
    reply: blob("library"),
    expected: "library",
  },
  {
    label: "function delete",
    command: Commands.functionDelete("lib"),
    tokens: ["FUNCTION", "DELETE", "lib"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "function dump",
    command: Commands.functionDump(),
    tokens: ["FUNCTION", "DUMP"],
    keys: [],
    reply: blob("serialized"),
    expected: bytes("serialized"),
  },
  {
    label: "function restore",
    command: Commands.functionRestore(bytes("serialized"), "REPLACE"),
    tokens: ["FUNCTION", "RESTORE", bytes("serialized"), "REPLACE"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "function flush",
    command: Commands.functionFlush("SYNC"),
    tokens: ["FUNCTION", "FLUSH", "SYNC"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "function kill",
    command: Commands.functionKill(),
    tokens: ["FUNCTION", "KILL"],
    keys: [],
    reply: ok,
    expected: undefined,
  },
  {
    label: "function help",
    command: Commands.functionHelp(),
    tokens: ["FUNCTION", "HELP"],
    keys: [],
    reply: array(blob("h")),
    expected: ["h"],
  },
  {
    label: "function stats",
    command: Commands.functionStats(),
    tokens: ["FUNCTION", "STATS"],
    keys: [],
    reply: array(blob("future"), integer(1n)),
    expected: [["future", integer(1n)]],
  },
  {
    label: "function list",
    command: Commands.functionList({ libraryName: "lib*", withCode: true }),
    tokens: ["FUNCTION", "LIST", "LIBRARYNAME", "lib*", "WITHCODE"],
    keys: [],
    reply: array(array(blob("future"), integer(1n))),
    expected: [[["future", integer(1n)]]],
  },
]);

it.effect("SCRIPT: key access, arity snapshots and malformed options remain explicit", () =>
  Effect.gen(function* () {
    const keys = ["a"];
    const prepared = yield* Commands.evalShaReadOnly("sha", { keys }, Reply.integer).prepare;
    keys.push("later");

    expect(prepared.tokens).toEqual(["EVALSHA_RO", "sha", "1", "a"]);
    expect(prepared.routing).toEqual({ _tag: "Keys", keys: [{ index: 3, access: "read" }] });
    const digests: [string, ...string[]] = ["sha"];
    const exists = yield* Commands.scriptExists(digests).prepare;
    digests.push("later");
    expect(yield* Effect.flip(exists.decode(array(integer(1n), integer(0n))))).toMatchObject({
      _tag: "ReplyError",
    });
    expect(
      yield* Effect.flip(Commands.functionList({ withCode: "yes" } as never).prepare),
    ).toMatchObject({ _tag: "CommandInputError" });
  }),
);
