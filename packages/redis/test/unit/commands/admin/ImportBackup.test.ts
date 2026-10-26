import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { Commands } from "#/index";
import { adminCases } from "#test/support/commands/AdminCase";
import { array, blob, integer, ok } from "#test/support/commands/CoreCase";

adminCases("public session imports", [
  {
    command: Commands.himportPrepare("fs", ["z", "a"]),
    tokens: ["HIMPORT", "PREPARE", "fs", "z", "a"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.himportSet("key", "fs", ["last", "first"]),
    tokens: ["HIMPORT", "SET", "key", "fs", "last", "first"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.himportDiscard("fs"),
    tokens: ["HIMPORT", "DISCARD", "fs"],
    reply: integer(1n),
    expected: 1n,
  },
  {
    command: Commands.himportDiscardAll(),
    tokens: ["HIMPORT", "DISCARDALL"],
    reply: integer(2n),
    expected: 2n,
  },
]);

adminCases("public backups", [
  { command: Commands.backupStart(), tokens: ["BACKUP", "START"], reply: ok, expected: undefined },
  { command: Commands.backupSeal(), tokens: ["BACKUP", "SEAL"], reply: ok, expected: undefined },
  { command: Commands.backupAbort(), tokens: ["BACKUP", "ABORT"], reply: ok, expected: undefined },
  {
    command: Commands.backupCleanup(),
    tokens: ["BACKUP", "CLEANUP"],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.backupList(), tokens: ["BACKUP", "LIST"], reply: array(), expected: [] },
  { command: Commands.backupHelp(), tokens: ["BACKUP", "HELP"], reply: array(), expected: [] },
]);

it.effect(
  "BACKUP: status projects exact times, redacts diagnostics and retains future fields/states",
  () =>
    Effect.gen(function* () {
      const prepared = yield* Commands.backupStatus().prepare;
      const reply = array(
        blob("state"),
        blob("future"),
        blob("error"),
        blob("private path"),
        blob("start_time"),
        integer(9007199254740993n),
        blob("end_time"),
        integer(0n),
        blob("extension"),
        array(),
      );
      const decoded = yield* prepared.decode(reply);

      expect(decoded.state).toBe("future");
      expect(decoded.startTimeSeconds).toBe(9007199254740993n);
      expect(Redacted.value(decoded.error)).toBe("private path");
      expect(Redacted.value(decoded.fields).at(-1)).toEqual(["extension", array()]);
      expect(yield* Effect.flip(prepared.decode(array()))).toMatchObject({ _tag: "ReplyError" });
      expect((yield* Commands.himportSet("key", "fs", ["v"]).prepare).routing).toEqual({
        _tag: "Keys",
        keys: [{ index: 2, access: "read-write" }],
      });
    }),
);
