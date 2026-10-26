import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands } from "#/index";
import { adminCases } from "#test/support/commands/AdminCase";
import { array, blob, bytes, integer, missing, ok } from "#test/support/commands/CoreCase";

adminCases("inspection", [
  {
    command: Commands.memoryDoctor(),
    tokens: ["MEMORY", "DOCTOR"],
    reply: blob("report"),
    expected: "report",
  },
  { command: Commands.memoryHelp(), tokens: ["MEMORY", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.memoryMallocStats(),
    tokens: ["MEMORY", "MALLOC-STATS"],
    reply: blob("report"),
    expected: "report",
  },
  { command: Commands.memoryPurge(), tokens: ["MEMORY", "PURGE"], reply: ok, expected: undefined },
  {
    command: Commands.memoryStats(),
    tokens: ["MEMORY", "STATS"],
    reply: array(blob("future"), integer(1n)),
    expected: [["future", integer(1n)]],
  },
  {
    command: Commands.memoryUsage("k", 0),
    tokens: ["MEMORY", "USAGE", "k", "SAMPLES", "0"],
    reply: missing,
    expected: Option.none(),
  },
  { command: Commands.moduleHelp(), tokens: ["MODULE", "HELP"], reply: array(), expected: [] },
  { command: Commands.moduleList(), tokens: ["MODULE", "LIST"], reply: array(), expected: [] },
  {
    command: Commands.moduleLoad("/module", ["arg"]),
    tokens: ["MODULE", "LOAD", "/module", "arg"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.moduleLoadEx("/module", { config: [["a", "v"]], args: ["arg"] }),
    tokens: ["MODULE", "LOADEX", "/module", "CONFIG", "a", "v", "ARGS", "arg"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.moduleUnload("m"),
    tokens: ["MODULE", "UNLOAD", "m"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.command(),
    tokens: ["COMMAND"],
    reply: array(integer(1n)),
    expected: [integer(1n)],
  },
  {
    command: Commands.commandInfo(["unknown"]),
    tokens: ["COMMAND", "INFO", "unknown"],
    reply: array(missing),
    expected: [missing],
  },
  {
    command: Commands.commandDocs(["get"]),
    tokens: ["COMMAND", "DOCS", "get"],
    reply: array(blob("future"), integer(1n)),
    expected: [["future", integer(1n)]],
  },
  {
    command: Commands.commandCount(),
    tokens: ["COMMAND", "COUNT"],
    reply: integer(600n),
    expected: 600n,
  },
  { command: Commands.commandHelp(), tokens: ["COMMAND", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.commandGetKeys(["MGET", "a", "b"]),
    tokens: ["COMMAND", "GETKEYS", "MGET", "a", "b"],
    reply: array(blob("a"), blob("b")),
    expected: [bytes("a"), bytes("b")],
  },
  {
    command: Commands.commandGetKeysAndFlags(["GET", "a"]),
    tokens: ["COMMAND", "GETKEYSANDFLAGS", "GET", "a"],
    reply: array(array(blob("a"), array(blob("RO")))),
    expected: [[bytes("a"), ["RO"]]],
  },
  {
    command: Commands.commandList({ by: "PATTERN", value: "g*" }),
    tokens: ["COMMAND", "LIST", "FILTERBY", "PATTERN", "g*"],
    reply: array(blob("get")),
    expected: ["get"],
  },
]);

adminCases("diagnostics", [
  {
    command: Commands.slowlogGet(-1),
    tokens: ["SLOWLOG", "GET", "-1"],
    reply: array(),
    expected: [],
  },
  { command: Commands.slowlogLen(), tokens: ["SLOWLOG", "LEN"], reply: integer(0n), expected: 0n },
  {
    command: Commands.slowlogReset(),
    tokens: ["SLOWLOG", "RESET"],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.slowlogHelp(), tokens: ["SLOWLOG", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.commandlogGet(-1, "large-reply"),
    tokens: ["COMMANDLOG", "GET", "-1", "large-reply"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.commandlogLen("slow"),
    tokens: ["COMMANDLOG", "LEN", "slow"],
    reply: integer(0n),
    expected: 0n,
  },
  {
    command: Commands.commandlogReset("large-request"),
    tokens: ["COMMANDLOG", "RESET", "large-request"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.commandlogHelp(),
    tokens: ["COMMANDLOG", "HELP"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.latencyDoctor(),
    tokens: ["LATENCY", "DOCTOR"],
    reply: blob("report"),
    expected: "report",
  },
  {
    command: Commands.latencyGraph("command"),
    tokens: ["LATENCY", "GRAPH", "command"],
    reply: blob("graph"),
    expected: "graph",
  },
  { command: Commands.latencyHelp(), tokens: ["LATENCY", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.latencyHistory("command"),
    tokens: ["LATENCY", "HISTORY", "command"],
    reply: array(array(integer(10n), integer(2n))),
    expected: [[10n, 2n]],
  },
  {
    command: Commands.latencyLatest(),
    tokens: ["LATENCY", "LATEST"],
    reply: array(array(blob("command"), integer(10n), integer(2n), integer(3n))),
    expected: [["command", 10n, 2n, 3n]],
  },
  {
    command: Commands.latencyHistogram(["GET"]),
    tokens: ["LATENCY", "HISTOGRAM", "GET"],
    reply: array(),
    expected: [],
  },
  {
    command: Commands.latencyReset(["command"]),
    tokens: ["LATENCY", "RESET", "command"],
    reply: integer(1n),
    expected: 1n,
  },
  {
    command: Commands.hotkeysStart({
      metrics: ["CPU", "NET"],
      count: 5,
      durationSeconds: 10,
      sampleRatio: 2,
      slots: [1, 2],
    }),
    tokens: [
      "HOTKEYS",
      "START",
      "METRICS",
      "2",
      "CPU",
      "NET",
      "COUNT",
      "5",
      "DURATION",
      "10",
      "SAMPLE",
      "2",
      "SLOTS",
      "2",
      "1",
      "2",
    ],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.hotkeysGet(), tokens: ["HOTKEYS", "GET"], reply: array(), expected: [] },
  { command: Commands.hotkeysStop(), tokens: ["HOTKEYS", "STOP"], reply: ok, expected: undefined },
  {
    command: Commands.hotkeysReset(),
    tokens: ["HOTKEYS", "RESET"],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.hotkeysHelp(), tokens: ["HOTKEYS", "HELP"], reply: array(), expected: [] },
]);

it.effect(
  "ADMIN INFO: unknown sections, duplicate counters, large integers and unusual lines survive",
  () =>
    Effect.gen(function* () {
      const raw =
        "# Future\r\nlarge:18446744073709551615\r\nfield:a:b\r\nfield:second\r\nunparsed line\r\n";
      const prepared = yield* Commands.info(["all"]).prepare;
      expect(prepared.tokens).toEqual(["INFO", "all"]);
      expect(yield* prepared.decode(blob(raw))).toEqual({
        raw,
        sections: [
          {
            name: "Future",
            fields: [
              ["large", "18446744073709551615"],
              ["field", "a:b"],
              ["field", "second"],
            ],
            unparsed: ["unparsed line"],
          },
        ],
      });
    }),
);
