import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { Commands } from "#/index";
import { adminCases } from "#test/support/commands/AdminCase";
import { array, blob, bytes, integer, missing, ok } from "#test/support/commands/CoreCase";

adminCases("ACL", [
  {
    command: Commands.aclCat("read"),
    tokens: ["ACL", "CAT", "read"],
    reply: array(blob("get")),
    expected: ["get"],
  },
  {
    command: Commands.aclDelUser(["u"]),
    tokens: ["ACL", "DELUSER", "u"],
    reply: integer(1n),
    expected: 1n,
  },
  {
    command: Commands.aclSetUser("u", Redacted.make(["on", ">secret"])),
    tokens: ["ACL", "SETUSER", "u", "on", ">secret"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.aclGetUser("u"),
    tokens: ["ACL", "GETUSER", "u"],
    reply: missing,
    expected: Option.none(),
  },
  {
    command: Commands.aclList(),
    tokens: ["ACL", "LIST"],
    reply: array(blob("private")),
    expected: ["private"],
  },
  {
    command: Commands.aclUsers(),
    tokens: ["ACL", "USERS"],
    reply: array(blob("u")),
    expected: ["u"],
  },
  { command: Commands.aclWhoAmI(), tokens: ["ACL", "WHOAMI"], reply: blob("u"), expected: "u" },
  {
    command: Commands.aclDigest(),
    tokens: ["ACL", "DIGEST"],
    reply: blob("hash"),
    expected: "hash",
  },
  {
    command: Commands.aclHelp(),
    tokens: ["ACL", "HELP"],
    reply: array(blob("help")),
    expected: ["help"],
  },
  { command: Commands.aclLoad(), tokens: ["ACL", "LOAD"], reply: ok, expected: undefined },
  { command: Commands.aclSave(), tokens: ["ACL", "SAVE"], reply: ok, expected: undefined },
  {
    command: Commands.aclGenPass(256),
    tokens: ["ACL", "GENPASS", "256"],
    reply: blob("secret"),
    expected: "secret",
  },
  {
    command: Commands.aclDryRun("u", ["GET", "k"]),
    tokens: ["ACL", "DRYRUN", "u", "GET", "k"],
    reply: ok,
    expected: "OK",
  },
  { command: Commands.aclLog(5), tokens: ["ACL", "LOG", "5"], reply: array(), expected: [] },
  {
    command: Commands.aclLogReset(),
    tokens: ["ACL", "LOG", "RESET"],
    reply: ok,
    expected: undefined,
  },
]);

adminCases("CONFIG", [
  {
    command: Commands.configGet(["a", "b"]),
    tokens: ["CONFIG", "GET", "a", "b"],
    reply: array(blob("a"), blob("v")),
    expected: [[bytes("a"), bytes("v")]],
  },
  {
    command: Commands.configSet(
      Redacted.make([
        ["a", "v"],
        ["b", "w"],
      ]),
    ),
    tokens: ["CONFIG", "SET", "a", "v", "b", "w"],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.configHelp(), tokens: ["CONFIG", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.configResetStat(),
    tokens: ["CONFIG", "RESETSTAT"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.configRewrite(),
    tokens: ["CONFIG", "REWRITE"],
    reply: ok,
    expected: undefined,
  },
]);

it.effect(
  "ADMIN: secret-bearing replies remain redacted, maps preserve unknown binary fields",
  () =>
    Effect.gen(function* () {
      const prepared = yield* Commands.configGet(["*"]).prepare;
      const result = yield* prepared.decode({
        _tag: "Map",
        entries: [[blob("future"), blob("private")]],
      });

      expect(JSON.stringify(result)).not.toContain("private");
      expect(Redacted.value(result)).toEqual([[bytes("future"), bytes("private")]]);
      expect(yield* Effect.flip(Commands.aclSetUser("u", ["on"] as never).prepare)).toMatchObject({
        _tag: "CommandInputError",
      });
      expect(yield* Effect.flip(Commands.configGet([] as never).prepare)).toMatchObject({
        _tag: "CommandInputError",
      });
    }),
);
