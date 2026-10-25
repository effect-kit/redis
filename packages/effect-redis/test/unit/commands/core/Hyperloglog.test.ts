import * as H from "#/commands/hyperloglog/index";
import { commandCases, integer, ok } from "#test/support/commands/CoreCase";

commandCases("CORE-HYPERLOGLOG", [
  {
    label: "PFADD empty creates",
    command: H.pfadd("k"),
    tokens: ["PFADD", "k"],
    reply: integer(1n),
    expected: true,
    keys: [1],
  },
  {
    label: "PFCOUNT multi key",
    command: H.pfcount(["a", "b"]),
    tokens: ["PFCOUNT", "a", "b"],
    reply: integer(3n),
    expected: 3n,
    keys: [1, 2],
  },
  {
    label: "PFMERGE destination",
    command: H.pfmerge("out", ["a", "b"]),
    tokens: ["PFMERGE", "out", "a", "b"],
    reply: ok,
    expected: undefined,
    keys: [1, 2, 3],
  },
]);
