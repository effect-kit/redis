import { Commands } from "#/index";
import { array, blob, commandCases, integer, ok } from "#test/support/commands/CoreCase";

commandCases("STREAM-GROUP", [
  {
    label: "CREATE",
    command: Commands.xgroupCreate("s", "g", "$", { mkstream: true, entriesRead: -1 }),
    tokens: ["XGROUP", "CREATE", "s", "g", "$", "MKSTREAM", "ENTRIESREAD", "-1"],
    reply: ok,
    expected: undefined,
    keys: [2],
  },
  {
    label: "SETID",
    command: Commands.xgroupSetid("s", "g", "0", { entriesRead: 0 }),
    tokens: ["XGROUP", "SETID", "s", "g", "0", "ENTRIESREAD", "0"],
    reply: ok,
    expected: undefined,
    keys: [2],
  },
  {
    label: "DESTROY",
    command: Commands.xgroupDestroy("s", "g"),
    tokens: ["XGROUP", "DESTROY", "s", "g"],
    reply: integer(1n),
    expected: true,
    keys: [2],
  },
  {
    label: "CREATECONSUMER",
    command: Commands.xgroupCreateconsumer("s", "g", "c"),
    tokens: ["XGROUP", "CREATECONSUMER", "s", "g", "c"],
    reply: integer(0n),
    expected: false,
    keys: [2],
  },
  {
    label: "DELCONSUMER",
    command: Commands.xgroupDelconsumer("s", "g", "c"),
    tokens: ["XGROUP", "DELCONSUMER", "s", "g", "c"],
    reply: integer(2n),
    expected: 2n,
    keys: [2],
  },
  {
    label: "HELP",
    command: Commands.xgroupHelp(),
    tokens: ["XGROUP", "HELP"],
    reply: array(blob("help")),
    expected: ["help"],
    keys: [],
  },
]);
